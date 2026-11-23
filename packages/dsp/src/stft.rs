//! Short-time Fourier transform with Hann windows and overlap-add resynthesis.

use crate::fft::{hann, Fft};

pub struct Stft {
    pub n: usize,
    pub hop: usize,
    fft: Fft,
    win: Vec<f32>,
}

/// Magnitudes and phases per frame, `bins = n / 2 + 1`.
pub struct Spectrum {
    pub frames: usize,
    pub bins: usize,
    pub mag: Vec<f32>,
    pub phase: Vec<f32>,
}

impl Stft {
    pub fn new(n: usize, hop: usize) -> Self {
        Stft { n, hop, fft: Fft::new(n), win: hann(n) }
    }

    pub fn analyze(&self, x: &[f32]) -> Spectrum {
        let n = self.n;
        let bins = n / 2 + 1;
        let frames = if x.len() == 0 { 0 } else { (x.len() + n) / self.hop + 1 };
        let mut mag = vec![0.0; frames * bins];
        let mut phase = vec![0.0; frames * bins];
        let mut re = vec![0.0; n];
        let mut im = vec![0.0; n];
        for f in 0..frames {
            // Frames are centred: frame f starts at f*hop - n/2.
            let start = f as isize * self.hop as isize - (n / 2) as isize;
            for i in 0..n {
                let idx = start + i as isize;
                re[i] = if idx >= 0 && (idx as usize) < x.len() { x[idx as usize] * self.win[i] } else { 0.0 };
                im[i] = 0.0;
            }
            self.fft.run(&mut re, &mut im, false);
            for b in 0..bins {
                mag[f * bins + b] = (re[b] * re[b] + im[b] * im[b]).sqrt();
                phase[f * bins + b] = im[b].atan2(re[b]);
            }
        }
        Spectrum { frames, bins, mag, phase }
    }

    /// Overlap-add resynthesis to `len` samples.
    pub fn synthesize(&self, s: &Spectrum, len: usize) -> Vec<f32> {
        let n = self.n;
        let mut out = vec![0.0f32; len];
        let mut norm = vec![0.0f32; len];
        let mut re = vec![0.0; n];
        let mut im = vec![0.0; n];
        for f in 0..s.frames {
            for b in 0..s.bins {
                let m = s.mag[f * s.bins + b];
                let p = s.phase[f * s.bins + b];
                re[b] = m * p.cos();
                im[b] = m * p.sin();
                if b > 0 && b < n / 2 {
                    re[n - b] = re[b];
                    im[n - b] = -im[b];
                }
            }
            self.fft.run(&mut re, &mut im, true);
            let start = f as isize * self.hop as isize - (n / 2) as isize;
            for i in 0..n {
                let idx = start + i as isize;
                if idx >= 0 && (idx as usize) < len {
                    let w = self.win[i];
                    out[idx as usize] += re[i] / n as f32 * w;
                    norm[idx as usize] += w * w;
                }
            }
        }
        for i in 0..len {
            if norm[i] > 1e-6 {
                out[i] /= norm[i];
            }
        }
        out
    }
}
