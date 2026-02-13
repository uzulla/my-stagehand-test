import { Stagehand } from "@browserbasehq/stagehand";
import path from "path";
import fs from "fs";
import { startRecording, framesToVideo, Recorder } from "./recording.js";
import { createScreenshotHelper, ScreenshotFn } from "./screenshot.js";

export const SCREENSHOT_DIR = path.resolve("screenshots");
export const RECORDING_DIR = path.resolve("recordings");
export const FRAMES_DIR = path.join(RECORDING_DIR, "frames");
export const BASELINES_DIR = path.resolve("baselines");

export const VISUAL_DIFF_THRESHOLD = 0.10; // 10%
const FRAME_INTERVAL_MS = 500;

export interface TestResult {
  step: string;
  passed: boolean;
  screenshot: string;
}

export interface TestContext {
  stagehand: Stagehand;
  page: any;
  screenshot: ScreenshotFn;
}

/**
 * テスト環境をセットアップする。
 * ディレクトリ準備 → Stagehand初期化 → 録画開始 → TestContext + Recorder を返す。
 */
export async function setupTestEnv(): Promise<{
  ctx: TestContext;
  recorder: Recorder;
}> {
  // 出力ディレクトリを準備（前回分をクリア）
  for (const dir of [SCREENSHOT_DIR, RECORDING_DIR]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const stagehand = new Stagehand({
    env: "LOCAL",
    model: "openai/gpt-4o",
    cacheDir: ".cache/cfe-test",
    localBrowserLaunchOptions: {
      headless: false,
      viewport: { width: 1280, height: 720 },
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  const screenshot = createScreenshotHelper(page, SCREENSHOT_DIR);

  // 動画録画を開始
  const recorder = startRecording(page, FRAMES_DIR, FRAME_INTERVAL_MS);
  console.log("[Recording] Started capturing frames...\n");

  return { ctx: { stagehand, page, screenshot }, recorder };
}

/**
 * テスト環境のティアダウン。
 * レポート出力 → 録画停止・動画生成 → stagehand.close()
 */
export async function teardownTestEnv(
  ctx: TestContext,
  recorder: Recorder,
  results: TestResult[]
): Promise<void> {
  reportResults(results);

  // 録画を停止してから動画を生成
  const totalFrames = await recorder.stop();
  console.log(`\n[Recording] Captured ${totalFrames} frames.`);

  await ctx.stagehand.close();

  if (totalFrames > 0) {
    const fps = Math.round(1000 / FRAME_INTERVAL_MS);
    console.log(`[Recording] Encoding video (${fps} fps)...`);
    const videoPath = framesToVideo(FRAMES_DIR, RECORDING_DIR, fps);
    if (videoPath) {
      console.log(`[Recording] Video saved: ${videoPath}`);
    }
  }
}

/**
 * テスト結果サマリを表示する。
 */
export function reportResults(results: TestResult[]): void {
  console.log("=== Test Results ===\n");
  const failed = results.filter((r) => !r.passed);
  for (const r of results) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}  ${r.step}`);
    console.log(`        screenshot: ${r.screenshot}`);
  }
  console.log("");

  if (failed.length > 0) {
    console.log(
      `${failed.length} test(s) FAILED. Screenshots for failed steps:`
    );
    for (const f of failed) {
      console.log(`  -> ${f.step}`);
      console.log(`     ${f.screenshot}`);
    }
    process.exitCode = 1;
  } else {
    console.log("All tests passed!");
  }
  console.log(`\nAll screenshots saved to: ${SCREENSHOT_DIR}/`);
}
