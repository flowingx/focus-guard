use serde::{Deserialize, Serialize};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub category: String, // "study", "distraction", "unknown"
    pub confidence: f64,
    pub description: String,
    pub timestamp: chrono::DateTime<chrono::Local>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: Vec<ContentPart>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlDetail },
}

#[derive(Debug, Serialize)]
struct ImageUrlDetail {
    url: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

pub struct AiAnalyzer {
    endpoint: String,
    model: String,
}

impl AiAnalyzer {
    pub fn new(endpoint: String, model: String) -> Self {
        Self { endpoint, model }
    }

    pub async fn analyze_screenshot(&self, image_data: &[u8]) -> Result<AnalysisResult, Box<dyn std::error::Error>> {
        let client = reqwest::Client::new();
        
        let base64_image = STANDARD.encode(image_data);
        let data_url = format!("data:image/png;base64,{}", base64_image);
        
        let prompt = r#"Analyze this screenshot and classify what the user is doing.
Return ONLY JSON (no other text):
{
    "category": "study" or "distraction" or "unknown",
    "confidence": 0.0 to 1.0,
    "description": "brief description of what user is doing"
}

Classification criteria:
- study: coding, reading docs, taking notes, watching tutorials, writing, studying
- distraction: watching videos, social media, gaming, browsing news, chatting
- unknown: cannot determine, desktop, lock screen

Return JSON only, nothing else."#;

        let request = ChatCompletionRequest {
            model: self.model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: vec![
                    ContentPart::ImageUrl { 
                        image_url: ImageUrlDetail { url: data_url } 
                    },
                    ContentPart::Text { text: prompt.to_string() },
                ],
            }],
            stream: false,
            max_tokens: 256,
        };

        let response = client
            .post(format!("{}/v1/chat/completions", self.endpoint))
            .json(&request)
            .send()
            .await?;

        let chat_response: ChatCompletionResponse = response.json().await?;
        
        let content = chat_response.choices.first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default();
        
        let result = self.parse_response(&content)?;
        
        Ok(result)
    }

    fn parse_response(&self, response: &str) -> Result<AnalysisResult, Box<dyn std::error::Error>> {
        let json_str = if let Some(start) = response.find('{') {
            if let Some(end) = response.rfind('}') {
                &response[start..=end]
            } else {
                response
            }
        } else {
            response
        };

        let parsed: serde_json::Value = serde_json::from_str(json_str)?;
        
        let category = parsed["category"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        
        let confidence = parsed["confidence"]
            .as_f64()
            .unwrap_or(0.5);
        
        let description = parsed["description"]
            .as_str()
            .unwrap_or("unable to parse description")
            .to_string();

        Ok(AnalysisResult {
            category,
            confidence,
            description,
            timestamp: chrono::Local::now(),
        })
    }

    pub async fn check_server_status(&self) -> bool {
        let client = reqwest::Client::new();
        match client.get(format!("{}/v1/models", self.endpoint)).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }
}

impl Default for AiAnalyzer {
    fn default() -> Self {
        Self {
            endpoint: "http://127.0.0.1:8080".to_string(),
            model: "Qwen3VL-4B-Instruct-Q4_K_M.gguf".to_string(),
        }
    }
}
