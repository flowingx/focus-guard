use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ReminderType {
    Notification,
    Sound,
    Overlay,
}

pub struct Reminder {
    reminder_type: ReminderType,
    enabled: bool,
}

impl Reminder {
    pub fn new(reminder_type: ReminderType) -> Self {
        Self {
            reminder_type,
            enabled: true,
        }
    }

    pub fn send(&self, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        if !self.enabled {
            return Ok(());
        }

        match self.reminder_type {
            ReminderType::Notification => {
                self.send_notification(message)?;
            }
            ReminderType::Sound => {
                self.play_sound()?;
            }
            ReminderType::Overlay => {
                self.show_overlay(message)?;
            }
        }

        Ok(())
    }

    fn send_notification(&self, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::UI::WindowsAndMessaging::MessageBoxW;
            use windows::Win32::Foundation::HWND;
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;

            let wide_message: Vec<u16> = OsStr::new(message)
                .encode_wide()
                .chain(Some(0))
                .collect();

            unsafe {
                MessageBoxW(
                    HWND(0),
                    windows::core::PCWSTR(wide_message.as_ptr()),
                    windows::core::w!("Focus Guard 提醒"),
                    windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_STYLE(0x40),
                );
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            println!("[提醒] {}", message);
        }

        Ok(())
    }

    fn play_sound(&self) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(target_os = "windows")]
        {
            println!("[声音提醒] 滴滴！");
        }

        #[cfg(not(target_os = "windows"))]
        {
            println!("[声音提醒] 滴滴！");
        }

        Ok(())
    }

    fn show_overlay(&self, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        // 显示屏幕覆盖层
        println!("[覆盖提醒] {}", message);
        Ok(())
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn set_type(&mut self, reminder_type: ReminderType) {
        self.reminder_type = reminder_type;
    }
}

impl Default for Reminder {
    fn default() -> Self {
        Self::new(ReminderType::Notification)
    }
}