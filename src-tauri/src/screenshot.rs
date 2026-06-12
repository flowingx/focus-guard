use std::path::PathBuf;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::Win32::Foundation::*;
use image::{ImageBuffer, Rgba};

pub struct ScreenshotCapture {
    save_dir: PathBuf,
}

impl ScreenshotCapture {
    pub fn new(save_dir: PathBuf) -> Self {
        if !save_dir.exists() {
            std::fs::create_dir_all(&save_dir).ok();
        }
        Self { save_dir }
    }

    pub fn capture_current_window(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0 == 0 {
                return Err("无法获取前台窗口".into());
            }

            let mut title_buf = [0u16; 256];
            let title_len = GetWindowTextW(hwnd, &mut title_buf);
            let _title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect)?;

            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;

            if width <= 0 || height <= 0 {
                return Err("窗口尺寸无效".into());
            }

            let hdc_screen = GetDC(None);
            let hdc_mem = CreateCompatibleDC(hdc_screen);
            let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);

            if hbitmap.0 == 0 {
                let _ = DeleteDC(hdc_mem);
                ReleaseDC(None, hdc_screen);
                return Err("CreateCompatibleBitmap failed".into());
            }

            let old_bitmap = SelectObject(hdc_mem, hbitmap);

            let _ = BitBlt(
                hdc_mem,
                0,
                0,
                width,
                height,
                hdc_screen,
                rect.left,
                rect.top,
                SRCCOPY,
            );

            let mut bitmap_info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD::default(); 1],
            };

            let mut pixels = vec![0u8; (width * height * 4) as usize];
            GetDIBits(
                hdc_mem,
                hbitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, old_bitmap);
            let _ = DeleteObject(hbitmap);
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(None, hdc_screen);

            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(
                width as u32,
                height as u32,
                pixels,
            )
            .ok_or("创建图像失败")?;

            let mut png_bytes = std::io::Cursor::new(Vec::new());
            img.write_to(&mut png_bytes, image::ImageFormat::Png)?;

            Ok(png_bytes.into_inner())
        }
    }

    pub fn save_screenshot(&self, data: &[u8]) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let now = chrono::Local::now();
        let millis = now.timestamp_millis() % 1000;
        let filename = format!("screenshot_{}_{:03}.png", now.format("%Y%m%d_%H%M%S"), millis);
        let filepath = self.save_dir.join(&filename);
        
        std::fs::write(&filepath, data)?;
        Ok(filepath)
    }
}

impl Default for ScreenshotCapture {
    fn default() -> Self {
        let save_dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("FocusGuard")
            .join("screenshots");
        Self::new(save_dir)
    }
}