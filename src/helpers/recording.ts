import path from "path";
import fs from "fs";
import { execSync } from "child_process";

export interface Recorder {
  stop: () => Promise<number>;
  /** 現在のページ状態をフレームとして即座に n 枚書き込む */
  injectFrames: (n?: number) => Promise<void>;
}

/**
 * ページのフレームキャプチャを開始する。
 * 返り値の stop() を呼ぶとキャプチャを終了し、撮影したフレーム数を返す。
 */
export function startRecording(
  page: any,
  framesDir: string,
  intervalMs = 500
): Recorder {
  let frameIndex = 0;
  let stopped = false;
  let injecting = false;

  const capture = async () => {
    while (!stopped) {
      if (!injecting) {
        try {
          const filePath = path.join(
            framesDir,
            `frame-${String(frameIndex).padStart(5, "0")}.png`
          );
          await page.screenshot({ path: filePath });
          frameIndex++;
        } catch {
          // ブラウザが閉じられた等の場合は無視
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  const promise = capture();

  return {
    injectFrames: async (n = 3) => {
      injecting = true;
      try {
        for (let i = 0; i < n; i++) {
          const filePath = path.join(
            framesDir,
            `frame-${String(frameIndex).padStart(5, "0")}.png`
          );
          await page.screenshot({ path: filePath });
          frameIndex++;
        }
      } catch {}
      injecting = false;
    },
    stop: async () => {
      stopped = true;
      await promise;
      return frameIndex;
    },
  };
}

/**
 * フレーム画像群を ffmpeg で MP4 動画に変換する。
 * 成功時は動画パスを返し、失敗時は null を返す。
 */
export function framesToVideo(
  framesDir: string,
  outputDir: string,
  fps: number
): string | null {
  const outputPath = path.join(outputDir, "test-recording.mp4");
  const pattern = path.join(framesDir, "frame-%05d.png");
  try {
    execSync(
      `ffmpeg -y -framerate ${fps} -i "${pattern}" -c:v libx264 -pix_fmt yuv420p "${outputPath}" 2>/dev/null`
    );
    // フレーム画像を削除
    fs.rmSync(framesDir, { recursive: true });
    return outputPath;
  } catch {
    console.error(
      "  ffmpeg conversion failed. Raw frames kept in:",
      framesDir
    );
    return null;
  }
}
