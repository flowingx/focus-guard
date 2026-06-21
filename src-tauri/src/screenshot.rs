use image::{DynamicImage, ImageBuffer, Rgba};
use std::path::PathBuf;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::WindowsAndMessaging::*;

pub struct ScreenshotCapture {
    save_dir: PathBuf,
}

const MAX_SCREENSHOT_EDGE: u32 = 1280;

impl ScreenshotCapture {
    pub fn new(save_dir: PathBuf) -> Self {
        if !save_dir.exists() {
            std::fs::create_dir_all(&save_dir).ok();
        }
        Self { save_dir }
    }

    pub fn capture_current_window(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        unsafe {
            let hdc_screen = GetDC(None);
            if hdc_screen.0 == 0 {
                return Err("获取屏幕DC失败".into());
            }

            let width = GetSystemMetrics(SM_CXSCREEN);
            let height = GetSystemMetrics(SM_CYSCREEN);

            if width <= 0 || height <= 0 {
                ReleaseDC(None, hdc_screen);
                return Err("屏幕尺寸无效".into());
            }

            let hdc_mem = CreateCompatibleDC(hdc_screen);
            let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);

            if hbitmap.0 == 0 {
                let _ = DeleteDC(hdc_mem);
                ReleaseDC(None, hdc_screen);
                return Err("CreateCompatibleBitmap failed".into());
            }

            let old_bitmap = SelectObject(hdc_mem, hbitmap);

            let _ = BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, 0, 0, SRCCOPY);

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

            bgra_to_rgba(&mut pixels);

            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(width as u32, height as u32, pixels)
                .ok_or("创建图像失败")?;
            let img =
                DynamicImage::ImageRgba8(img).thumbnail(MAX_SCREENSHOT_EDGE, MAX_SCREENSHOT_EDGE);

            let mut png_bytes = std::io::Cursor::new(Vec::new());
            img.write_to(&mut png_bytes, image::ImageFormat::Png)?;

            Ok(png_bytes.into_inner())
        }
    }

    pub fn save_screenshot(&self, data: &[u8]) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let now = chrono::Local::now();
        let millis = now.timestamp_millis() % 1000;
        let filename = format!(
            "screenshot_{}_{:03}.png",
            now.format("%Y%m%d_%H%M%S"),
            millis
        );
        let filepath = self.save_dir.join(&filename);

        std::fs::write(&filepath, data)?;
        Ok(filepath)
    }
}

fn bgra_to_rgba(pixels: &mut [u8]) {
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }
}

#[cfg(test)]
mod tests {
    use super::{bgra_to_rgba, MAX_SCREENSHOT_EDGE};

    #[test]
    fn bgra_to_rgba_swaps_blue_and_red_channels() {
        let mut pixels = vec![10, 20, 30, 0, 1, 2, 3, 128];

        bgra_to_rgba(&mut pixels);

        assert_eq!(pixels, vec![30, 20, 10, 255, 3, 2, 1, 255]);
    }

    #[test]
    fn max_screenshot_edge_keeps_ai_payload_reasonable() {
        assert_eq!(MAX_SCREENSHOT_EDGE, 1280);
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
