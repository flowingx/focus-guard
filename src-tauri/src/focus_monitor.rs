use crate::ai_analyzer::AnalysisResult;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusStats {
    #[serde(skip)]
    pub total_time: Duration,
    #[serde(skip)]
    pub study_time: Duration,
    #[serde(skip)]
    pub distraction_time: Duration,
    #[serde(skip)]
    pub unknown_time: Duration,
    pub study_percentage: f64,
    pub distraction_percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusState {
    pub is_focused: bool,
    pub current_activity: String,
    pub confidence: f64,
    pub should_remind: bool,
    pub reminder_message: Option<String>,
}

pub struct FocusMonitor {
    analysis_history: VecDeque<AnalysisResult>,
    max_history: usize,
    distraction_threshold: f64,
    reminder_interval: Duration,
    last_reminder: Option<Instant>,
    session_start: Instant,
}

impl FocusMonitor {
    pub fn new() -> Self {
        Self {
            analysis_history: VecDeque::new(),
            max_history: 20,                             // 保留最近20次分析
            distraction_threshold: 0.6,                  // 60%摸鱼触发提醒
            reminder_interval: Duration::from_secs(300), // 5分钟提醒间隔
            last_reminder: None,
            session_start: Instant::now(),
        }
    }

    pub fn add_analysis(&mut self, result: AnalysisResult) {
        if self.analysis_history.len() >= self.max_history {
            self.analysis_history.pop_front();
        }
        self.analysis_history.push_back(result);
    }

    pub fn get_current_state(&self) -> FocusState {
        if let Some(latest) = self.analysis_history.back() {
            let should_remind = self.should_remind();
            let reminder_message = if should_remind {
                Some(self.generate_reminder_message())
            } else {
                None
            };

            FocusState {
                is_focused: latest.category == "study",
                current_activity: latest.description.clone(),
                confidence: latest.confidence,
                should_remind,
                reminder_message,
            }
        } else {
            FocusState {
                is_focused: true,
                current_activity: "等待分析...".to_string(),
                confidence: 0.0,
                should_remind: false,
                reminder_message: None,
            }
        }
    }

    pub fn should_remind(&self) -> bool {
        if self.analysis_history.is_empty() {
            return false;
        }

        // 检查是否到了提醒时间
        if let Some(last_reminder) = self.last_reminder {
            if last_reminder.elapsed() < self.reminder_interval {
                return false;
            }
        }

        // 计算最近N次分析中摸鱼的比例
        let recent_count = self.analysis_history.len().min(5);
        let recent_distractions = self
            .analysis_history
            .iter()
            .rev()
            .take(recent_count)
            .filter(|r| r.category == "distraction")
            .count();

        let distraction_ratio = recent_distractions as f64 / recent_count as f64;

        distraction_ratio >= self.distraction_threshold
    }

    pub fn mark_reminded(&mut self) {
        self.last_reminder = Some(Instant::now());
    }

    fn generate_reminder_message(&self) -> String {
        let messages = [
            "嘿，看起来你在摸鱼哦！该回去学习了！",
            "注意！检测到分心行为，专注力下降！",
            "别玩了，想想你的目标！",
            "短暂休息可以，但别太久哦！",
            "学习时间到！让我们继续努力！",
            "检测到你在看非学习内容，该集中注意力了！",
        ];

        let index = (Instant::now().elapsed().as_secs() as usize) % messages.len();
        messages[index].to_string()
    }

    pub fn get_stats(&self) -> FocusStats {
        let total_time = self.session_start.elapsed();
        let mut study_time = Duration::ZERO;
        let mut distraction_time = Duration::ZERO;
        let mut unknown_time = Duration::ZERO;

        let analysis_count = self.analysis_history.len() as u64;
        if analysis_count > 0 {
            let avg_interval = total_time / analysis_count as u32;

            for result in &self.analysis_history {
                match result.category.as_str() {
                    "study" => study_time += avg_interval,
                    "distraction" => distraction_time += avg_interval,
                    _ => unknown_time += avg_interval,
                }
            }
        }

        let total_secs = total_time.as_secs_f64();
        let study_percentage = if total_secs > 0.0 {
            study_time.as_secs_f64() / total_secs * 100.0
        } else {
            0.0
        };
        let distraction_percentage = if total_secs > 0.0 {
            distraction_time.as_secs_f64() / total_secs * 100.0
        } else {
            0.0
        };

        FocusStats {
            total_time,
            study_time,
            distraction_time,
            unknown_time,
            study_percentage,
            distraction_percentage,
        }
    }

    pub fn set_distraction_threshold(&mut self, threshold: f64) {
        self.distraction_threshold = threshold.clamp(0.0, 1.0);
    }

    pub fn set_reminder_interval(&mut self, interval: Duration) {
        self.reminder_interval = interval;
    }
}

impl Default for FocusMonitor {
    fn default() -> Self {
        Self::new()
    }
}
