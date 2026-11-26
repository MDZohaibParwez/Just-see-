//! Just See audio DSP. Plain C ABI so it loads with `WebAssembly.instantiate`
//! without any JS glue generator. All buffers are f32 mono.

pub mod fft;
pub mod stft;

use stft::{Spectrum, Stft};

// ---------- Memory helpers for the JS side ----------

#[no_mangle]
pub extern "C" fn js_alloc(len: usize) -> *mut f32 {
    let mut v = vec![0.0f32; len];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn js_free(ptr: *mut f32, len: usize) {
    drop(Vec::from_raw_parts(ptr, len, len));
}

unsafe fn slice<'a>(ptr: *const f32, len: usize) -> &'a [f32] {
    std::slice::from_raw_parts(ptr, len)
}
unsafe fn slice_mut<'a>(ptr: *mut f32, len: usize) -> &'a mut [f32] {
    std::slice::from_raw_parts_mut(ptr, len)
}

// ---------- Noise reduction ----------

/// Spectral noise gate. `noise` is a sample of only-noise audio; when empty
/// the profile is the 10th percentile of each bin over the whole input.
pub fn denoise(x: &[f32], noise: &[f32], strength: f32) -> Vec<f32> {
    let st = Stft::new(2048, 512);
    let mut s = st.analyze(x);
    let bins = s.bins;
    let mut profile = vec![0.0f32; bins];
    if noise.len() > 2048 {
        let ns = st.analyze(noise);
        for b in 0..bins {
            let mut acc = 0.0;
            for f in 0..ns.frames {
                acc += ns.mag[f * bins + b];
            }
            profile[b] = acc / ns.frames.max(1) as f32;
        }
    } else {
        let mut col = vec![0.0f32; s.frames];
        for b in 0..bins {
            for f in 0..s.frames {
                col[f] = s.mag[f * bins + b];
            }
            col.sort_by(|a, c| a.partial_cmp(c).unwrap_or(std::cmp::Ordering::Equal));
            // A quiet-frame percentile is a robust noise estimate when speech has pauses.
            profile[b] = col[(s.frames * 3 / 10).min(s.frames.saturating_sub(1))] * 1.3;
        }
    }
    let over = 1.0 + 1.5 * strength;
    let floor = (1.0 - strength).max(0.02) * 0.15;
    // Gains smoothed over time and frequency to avoid "musical noise".
    let mut gains = vec![0.0f32; s.frames * bins];
    for f in 0..s.frames {
        for b in 0..bins {
            let m = s.mag[f * bins + b];
            let n = profile[b] * over;
            let g = if m <= 1e-9 { floor } else { ((m - n) / m).max(floor) };
            gains[f * bins + b] = g;
        }
    }
    let mut smooth = gains.clone();
    for f in 0..s.frames {
        for b in 0..bins {
            let mut acc = 0.0;
            let mut w = 0.0;
            for df in -2i32..=2 {
                for db in -1i32..=1 {
                    let ff = f as i32 + df;
                    let bb = b as i32 + db;
                    if ff < 0 || bb < 0 || ff >= s.frames as i32 || bb >= bins as i32 {
                        continue;
                    }
                    let k = if df == 0 && db == 0 { 2.0 } else { 1.0 };
                    acc += gains[ff as usize * bins + bb as usize] * k;
                    w += k;
                }
            }
            smooth[f * bins + b] = acc / w;
        }
    }
    for i in 0..s.mag.len() {
        s.mag[i] *= smooth[i];
    }
    st.synthesize(&s, x.len())
}

#[no_mangle]
pub unsafe extern "C" fn dsp_denoise(x: *const f32, len: usize, noise: *const f32, noise_len: usize, strength: f32, out: *mut f32) {
    let y = denoise(slice(x, len), if noise_len > 0 { slice(noise, noise_len) } else { &[] }, strength.clamp(0.0, 1.0));
    slice_mut(out, len).copy_from_slice(&y);
}

// ---------- Harmonic / percussive separation ----------

fn median(v: &mut [f32]) -> f32 {
    let mid = v.len() / 2;
    v.select_nth_unstable_by(mid, |a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    v[mid]
}

/// Split into harmonic (sustained) and percussive (transient) parts with
/// median filtering across time and frequency (Fitzgerald 2010 idea).
pub fn hpss(x: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let st = Stft::new(2048, 512);
    let s = st.analyze(x);
    let (frames, bins) = (s.frames, s.bins);
    let kt = 17usize; // time median length (frames)
    let kf = 17usize; // frequency median length (bins)
    let mut h = vec![0.0f32; frames * bins];
    let mut p = vec![0.0f32; frames * bins];
    let mut buf = Vec::with_capacity(kt.max(kf));
    for f in 0..frames {
        for b in 0..bins {
            buf.clear();
            for d in 0..kt {
                let ff = f as isize + d as isize - (kt / 2) as isize;
                if ff >= 0 && (ff as usize) < frames {
                    buf.push(s.mag[ff as usize * bins + b]);
                }
            }
            h[f * bins + b] = median(&mut buf);
            buf.clear();
            for d in 0..kf {
                let bb = b as isize + d as isize - (kf / 2) as isize;
                if bb >= 0 && (bb as usize) < bins {
                    buf.push(s.mag[f * bins + bb as usize]);
                }
            }
            p[f * bins + b] = median(&mut buf);
        }
    }
    let mut hs = Spectrum { frames, bins, mag: vec![0.0; frames * bins], phase: s.phase.clone() };
    let mut ps = Spectrum { frames, bins, mag: vec![0.0; frames * bins], phase: s.phase.clone() };
    for i in 0..frames * bins {
        // Soft (Wiener-like) masks.
        let hh = h[i] * h[i];
        let pp = p[i] * p[i];
        let sum = hh + pp + 1e-12;
        hs.mag[i] = s.mag[i] * hh / sum;
        ps.mag[i] = s.mag[i] * pp / sum;
    }
    (st.synthesize(&hs, x.len()), st.synthesize(&ps, x.len()))
}

#[no_mangle]
pub unsafe extern "C" fn dsp_hpss(x: *const f32, len: usize, harm: *mut f32, perc: *mut f32) {
    let (h, p) = hpss(slice(x, len));
    slice_mut(harm, len).copy_from_slice(&h);
    slice_mut(perc, len).copy_from_slice(&p);
}

// ---------- Time-stretch and pitch shift ----------

/// Phase-vocoder time-stretch. `ratio` > 1 makes the audio longer.
pub fn time_stretch(x: &[f32], ratio: f32) -> Vec<f32> {
    let n = 2048;
    let hop_out = 512;
    let ratio = ratio.clamp(0.25, 4.0);
    let hop_in = (hop_out as f32 / ratio).max(1.0);
    let st_in = Stft::new(n, hop_out);
    let s = st_in.analyze(x);
    let bins = s.bins;
    let out_len = (x.len() as f32 * ratio).round() as usize;
    let out_frames = out_len / hop_out + 2;
    let mut o = Spectrum { frames: out_frames, bins, mag: vec![0.0; out_frames * bins], phase: vec![0.0; out_frames * bins] };
    let two_pi = std::f32::consts::PI * 2.0;
    let mut acc_phase = vec![0.0f32; bins];
    // Analysis frames are hop_out apart in `s`; read them at a fractional
    // position that advances hop_in samples per output frame.
    for of in 0..out_frames {
        let pos = of as f32 * hop_in / hop_out as f32;
        let f0 = pos.floor() as usize;
        if f0 + 1 >= s.frames {
            break;
        }
        let frac = pos - f0 as f32;
        for b in 0..bins {
            let m = s.mag[f0 * bins + b] * (1.0 - frac) + s.mag[(f0 + 1) * bins + b] * frac;
            let expected = two_pi * b as f32 * hop_out as f32 / n as f32;
            let mut dp = s.phase[(f0 + 1) * bins + b] - s.phase[f0 * bins + b] - expected;
            dp -= two_pi * (dp / two_pi).round();
            if of == 0 {
                acc_phase[b] = s.phase[f0 * bins + b];
            } else {
                acc_phase[b] += expected + dp;
            }
            o.mag[of * bins + b] = m;
            o.phase[of * bins + b] = acc_phase[b];
        }
    }
    Stft::new(n, hop_out).synthesize(&o, out_len)
}

/// Linear-interpolation resampler by `factor` (output length = len / factor).
fn resample(x: &[f32], factor: f32) -> Vec<f32> {
    let out_len = (x.len() as f32 / factor).round() as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f32 * factor;
            let a = pos.floor() as usize;
            let f = pos - a as f32;
            let s0 = *x.get(a).unwrap_or(&0.0);
            let s1 = *x.get(a + 1).unwrap_or(&s0);
            s0 + (s1 - s0) * f
        })
        .collect()
}

/// Pitch shift keeping duration: stretch by 2^(st/12), then resample back.
pub fn pitch_shift(x: &[f32], semitones: f32) -> Vec<f32> {
    if semitones.abs() < 1e-3 {
        return x.to_vec();
    }
    let k = 2f32.powf(semitones / 12.0);
    let stretched = time_stretch(x, k);
    let mut y = resample(&stretched, k);
    y.resize(x.len(), 0.0);
    y
}

#[no_mangle]
pub unsafe extern "C" fn dsp_time_stretch_len(len: usize, ratio: f32) -> usize {
    (len as f32 * ratio.clamp(0.25, 4.0)).round() as usize
}

#[no_mangle]
pub unsafe extern "C" fn dsp_time_stretch(x: *const f32, len: usize, ratio: f32, out: *mut f32) {
    let y = time_stretch(slice(x, len), ratio);
    let o = slice_mut(out, y.len());
    o.copy_from_slice(&y);
}

#[no_mangle]
pub unsafe extern "C" fn dsp_pitch_shift(x: *const f32, len: usize, semitones: f32, out: *mut f32) {
    let y = pitch_shift(slice(x, len), semitones.clamp(-24.0, 24.0));
    slice_mut(out, len).copy_from_slice(&y);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(f: f32, sr: f32, n: usize) -> Vec<f32> {
        (0..n).map(|i| (2.0 * std::f32::consts::PI * f * i as f32 / sr).sin() * 0.5).collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn stft_round_trip() {
        let x = sine(440.0, 16000.0, 16000);
        let st = Stft::new(2048, 512);
        let y = st.synthesize(&st.analyze(&x), x.len());
        let err: f32 = x.iter().zip(&y).skip(2048).take(10000).map(|(a, b)| (a - b).abs()).sum::<f32>() / 10000.0;
        assert!(err < 1e-3, "err {err}");
    }

    #[test]
    fn denoise_reduces_noise() {
        let sr = 16000.0;
        let mut seed = 1u32;
        let mut rnd = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let clean: Vec<f32> = (0..32000).map(|i| if (i / 4000) % 2 == 0 { (i as f32 * 0.2).sin() * 0.4 } else { 0.0 }).collect();
        let noisy: Vec<f32> = clean.iter().map(|c| c + rnd() * 0.05).collect();
        let y = denoise(&noisy, &[], 0.8);
        // Measure the noise in a silent stretch.
        let before = rms(&noisy[4500..7500]);
        let after = rms(&y[4500..7500]);
        assert!(after < before * 0.35, "before {before} after {after}");
        // Speech-like part keeps its level.
        assert!(rms(&y[500..3500]) > rms(&clean[500..3500]) * 0.8);
        let _ = sr;
    }

    #[test]
    fn hpss_splits_tone_and_clicks() {
        let n = 32000;
        let tone = sine(300.0, 16000.0, n);
        let mut clicks = vec![0.0f32; n];
        for k in (1000..n).step_by(4000) {
            clicks[k] = 1.0;
        }
        let mix: Vec<f32> = tone.iter().zip(&clicks).map(|(a, b)| a + b).collect();
        let (h, p) = hpss(&mix);
        // Harmonic part keeps the tone, percussive part keeps the clicks.
        assert!(rms(&h[2000..3000]) > rms(&p[2000..3000]) * 3.0);
        let pk = p[5000 - 5..5000 + 5].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let hk = h[5000 - 5..5000 + 5].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(pk > 0.3, "click peak {pk}");
        let _ = hk;
    }

    #[test]
    fn time_stretch_length_and_pitch() {
        let x = sine(440.0, 16000.0, 16000);
        let y = time_stretch(&x, 1.5);
        assert_eq!(y.len(), 24000);
        // Zero crossings per second stay ≈ 880 (pitch unchanged).
        let zc = y[4000..20000].windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f32 / 1.0;
        assert!((zc - 440.0).abs() < 25.0, "crossings {zc}");
    }

    #[test]
    fn pitch_shift_octave_up() {
        let x = sine(220.0, 16000.0, 32000);
        let y = pitch_shift(&x, 12.0);
        assert_eq!(y.len(), x.len());
        let zc = y[4000..20000].windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f32;
        assert!((zc - 440.0).abs() < 30.0, "crossings {zc}");
    }
}
