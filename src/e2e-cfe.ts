import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/**
 * E2E Test: https://cfe.jp/ (uzulla's profile page)
 *
 * 各ステップでスクリーンショットを保存し、失敗時にどのステップで
 * 何が起きたかを視覚的に確認できるようにする。
 * テスト全体の動画も recordings/ に保存する。
 */

const SCREENSHOT_DIR = path.resolve("screenshots");
const RECORDING_DIR = path.resolve("recordings");
const FRAMES_DIR = path.join(RECORDING_DIR, "frames");
const BASELINES_DIR = path.resolve("baselines");

// ---- ビジュアルリグレッション検知 ----

const VISUAL_DIFF_THRESHOLD = 0.10; // 10% 以上のピクセル差異で「崩壊」と判定

/**
 * 2枚の PNG スクリーンショットを比較し、差異の割合と diff 画像を返す。
 * ベースラインが存在しない場合は比較をスキップ。
 */
function compareScreenshots(
  currentPath: string,
  baselinePath: string,
  diffPath: string
): { mismatchRatio: number; diffSaved: boolean; skipped: boolean } {
  if (!fs.existsSync(baselinePath)) {
    return { mismatchRatio: 0, diffSaved: false, skipped: true };
  }

  const img1 = PNG.sync.read(fs.readFileSync(currentPath));
  const img2 = PNG.sync.read(fs.readFileSync(baselinePath));

  // サイズが異なる場合は大幅な変化とみなす
  if (img1.width !== img2.width || img1.height !== img2.height) {
    console.log(
      `  Image size mismatch: current=${img1.width}x${img1.height} baseline=${img2.width}x${img2.height}`
    );
    return { mismatchRatio: 1, diffSaved: false, skipped: false };
  }

  const { width, height } = img1;
  const diff = new PNG({ width, height });
  const numDiffPixels = pixelmatch(
    img1.data,
    img2.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );

  const mismatchRatio = numDiffPixels / (width * height);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return { mismatchRatio, diffSaved: true, skipped: false };
}

/**
 * 現在のスクリーンショットをベースラインとして保存する。
 */
function saveBaseline(screenshotPath: string, baselineName: string) {
  if (!fs.existsSync(BASELINES_DIR)) {
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
  }
  const dest = path.join(BASELINES_DIR, `${baselineName}.png`);
  fs.copyFileSync(screenshotPath, dest);
  return dest;
}

// ---- 動画録画ユーティリティ ----

function startRecording(page: any, intervalMs = 500) {
  let frameIndex = 0;
  let stopped = false;

  const capture = async () => {
    while (!stopped) {
      try {
        const filePath = path.join(
          FRAMES_DIR,
          `frame-${String(frameIndex).padStart(5, "0")}.png`
        );
        await page.screenshot({ path: filePath });
        frameIndex++;
      } catch {
        // ブラウザが閉じられた等の場合は無視
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  const promise = capture();

  return {
    stop: async () => {
      stopped = true;
      await promise;
      return frameIndex;
    },
  };
}

function framesToVideo(fps: number) {
  const outputPath = path.join(RECORDING_DIR, "test-recording.mp4");
  const pattern = path.join(FRAMES_DIR, "frame-%05d.png");
  try {
    execSync(
      `ffmpeg -y -framerate ${fps} -i "${pattern}" -c:v libx264 -pix_fmt yuv420p "${outputPath}" 2>/dev/null`
    );
    // フレーム画像を削除
    fs.rmSync(FRAMES_DIR, { recursive: true });
    return outputPath;
  } catch {
    console.error("  ffmpeg conversion failed. Raw frames kept in:", FRAMES_DIR);
    return null;
  }
}

// ---- メイン ----

async function main() {
  console.log("=== Stagehand E2E Test: https://cfe.jp/ ===\n");

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

  const results: { step: string; passed: boolean; screenshot: string }[] = [];

  async function screenshot(name: string, targetPage = page) {
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
    try {
      await targetPage.screenshot({ path: filePath, fullPage: true });
    } catch {
      await targetPage.screenshot({ path: filePath });
    }
    return filePath;
  }

  // 動画録画を開始 (500ms 間隔でフレームをキャプチャ)
  const FRAME_INTERVAL_MS = 500;
  const recorder = startRecording(page, FRAME_INTERVAL_MS);
  console.log("[Recording] Started capturing frames...\n");

  try {
    // --------------------------------------------------
    // Test 1: Navigate to the page
    // --------------------------------------------------
    console.log("[Test 1] Navigating to https://cfe.jp/ ...");
    await page.goto("https://cfe.jp/");
    await page.waitForLoadState("networkidle");
    const ss1 = await screenshot("01-page-loaded");
    results.push({ step: "Test 1: Page navigation", passed: true, screenshot: ss1 });
    console.log("[Test 1] PASSED: Page loaded successfully.\n");

    // --------------------------------------------------
    // Test 2: Extract profile information
    // --------------------------------------------------
    console.log("[Test 2] Extracting profile information ...");
    const profileSchema = z.object({
      name: z.string().describe("The person's name"),
      description: z
        .string()
        .describe("Job title or short description shown on the page"),
      snsLinks: z
        .array(z.string())
        .describe("List of SNS/social link labels displayed on the page"),
    });
    const profile = await stagehand.extract(
      "Extract the person's name, their job title or description, and a list of their SNS/social media link labels (e.g., Twitter, GitHub, etc.)",
      profileSchema
    );
    console.log("  Name:", profile.name);
    console.log("  Description:", profile.description);
    console.log("  SNS Links:", profile.snsLinks.join(", "));

    const ss2 = await screenshot("02-profile-extracted");
    const test2Passed = profile.name.length > 0 && profile.snsLinks.length > 0;
    results.push({ step: "Test 2: Profile extraction", passed: test2Passed, screenshot: ss2 });
    console.log(
      `[Test 2] ${test2Passed ? "PASSED" : "FAILED"}: Profile extraction.\n`
    );

    // --------------------------------------------------
    // Test 3: Extract book (著書) information
    // --------------------------------------------------
    console.log("[Test 3] Extracting book information ...");
    const booksSchema = z.object({
      books: z.array(
        z.object({
          title: z.string().describe("Book title"),
          description: z
            .string()
            .describe("Short description or summary of the book"),
        })
      ),
    });
    const books = await stagehand.extract(
      "Extract information about the books (著書) listed on this page, including the title and a short description for each book.",
      booksSchema
    );
    console.log(`  Found ${books.books.length} book(s):`);
    for (const book of books.books) {
      console.log(`    - "${book.title}": ${book.description}`);
    }

    const ss3 = await screenshot("03-books-extracted");
    const test3Passed = books.books.length > 0;
    results.push({ step: "Test 3: Book extraction", passed: test3Passed, screenshot: ss3 });
    console.log(
      `[Test 3] ${test3Passed ? "PASSED" : "FAILED"}: Book extraction.\n`
    );

    // --------------------------------------------------
    // Test 4: Observe clickable links on the page
    // --------------------------------------------------
    console.log("[Test 4] Observing clickable links on the page ...");
    const actions = await stagehand.observe(
      "Find all clickable links on this page"
    );
    console.log(`  Found ${actions.length} actionable elements.`);
    for (const action of actions.slice(0, 5)) {
      console.log(`    - ${action.description} [${action.method}]`);
    }
    if (actions.length > 5) {
      console.log(`    ... and ${actions.length - 5} more.`);
    }

    const ss4 = await screenshot("04-links-observed");
    const test4Passed = actions.length > 0;
    results.push({ step: "Test 4: Link observation", passed: test4Passed, screenshot: ss4 });
    console.log(
      `[Test 4] ${test4Passed ? "PASSED" : "FAILED"}: Link observation.\n`
    );

    // --------------------------------------------------
    // Test 5: Click a link using act() + assert destination
    //         (ビジュアルリグレッション検知 + セルフヒール付き)
    // --------------------------------------------------
    console.log("[Test 5] Clicking the GitHub link using act() ...");

    // ビューポートサイズのスクリーンショット (fullPage なし) でベースライン比較
    const comparisonSsPath = path.join(SCREENSHOT_DIR, "05a-before-click.png");
    await page.screenshot({ path: comparisonSsPath });
    console.log(`  Pre-click screenshot: ${comparisonSsPath}`);

    // ベースラインとの比較
    const baselinePath = path.join(BASELINES_DIR, "05a-before-click.png");
    const diffPath = path.join(SCREENSHOT_DIR, "05a-diff.png");
    const comparison = compareScreenshots(comparisonSsPath, baselinePath, diffPath);

    let pageVisuallyBroken = false;
    if (comparison.skipped) {
      console.log("  No baseline found — first run, will save baseline on success.");
    } else {
      const pct = (comparison.mismatchRatio * 100).toFixed(2);
      console.log(`  Visual diff against baseline: ${pct}%`);
      if (comparison.mismatchRatio > VISUAL_DIFF_THRESHOLD) {
        pageVisuallyBroken = true;
        console.log(`  VISUAL REGRESSION DETECTED (threshold: ${VISUAL_DIFF_THRESHOLD * 100}%)`);
        if (comparison.diffSaved) {
          console.log(`  Diff image saved: ${diffPath}`);
        }
      } else {
        console.log("  Page looks visually OK.");
      }
    }

    if (pageVisuallyBroken) {
      // ページが崩壊している → セルフヒールせず即 FAIL
      results.push({
        step: "Test 5: Click GitHub link",
        passed: false,
        screenshot: diffPath,
      });
      console.log("[Test 5] FAILED: Visual regression detected — page appears broken.\n");
    } else {
      // act() 実行 + アサーション (セルフヒール付き)
      const actAndAssert = async (): Promise<{
        success: boolean;
        githubPage: any;
        allPages: any[];
      }> => {
        await stagehand.act("Click the GitHub link");
        await new Promise((r) => setTimeout(r, 2000));
        const allPages = stagehand.context.pages();
        const githubPage = allPages.find((p: any) => p.url().includes("github.com"));
        return { success: !!githubPage, githubPage, allPages };
      };

      let attempt = await actAndAssert();

      if (!attempt.success) {
        // アサーション失敗 → セルフヒール: キャッシュ削除して再試行
        console.log("  GitHub page not found after act(). Attempting self-heal...");

        // 間違って開いたタブを閉じる
        const extraPages = attempt.allPages.filter((p: any) => p !== page);
        for (const ep of extraPages) {
          try { await ep.close(); } catch {}
        }

        // キャッシュを削除
        const cacheDir = path.resolve(".cache/cfe-test");
        if (fs.existsSync(cacheDir)) {
          fs.rmSync(cacheDir, { recursive: true });
          fs.mkdirSync(cacheDir, { recursive: true });
          console.log("  Cache cleared.");
        }

        // ページを再読み込みして再試行
        await page.goto("https://cfe.jp/");
        await page.waitForLoadState("networkidle");
        console.log("  Retrying act() without cache...");

        attempt = await actAndAssert();

        if (attempt.success) {
          console.log("  Self-heal SUCCEEDED: GitHub page opened on retry.");
        } else {
          console.log("  Self-heal FAILED: GitHub page still not found after retry.");
        }
      }

      // 新しく開いたタブのスクリーンショット
      const newTab = attempt.allPages[attempt.allPages.length - 1];
      if (newTab !== page) {
        await newTab.waitForLoadState("domcontentloaded").catch(() => {});
        const newTabSs = await screenshot("05b-new-tab", newTab);
        console.log(`  New tab screenshot: ${newTabSs}`);
      }

      if (attempt.success) {
        console.log("  Navigated to:", attempt.githubPage.url());
        results.push({
          step: "Test 5: Click GitHub link",
          passed: true,
          screenshot: path.join(SCREENSHOT_DIR, "05b-new-tab.png"),
        });
        console.log("[Test 5] PASSED: GitHub page opened.\n");

        // 成功時: 現在のスクリーンショットをベースラインとして保存
        const saved = saveBaseline(comparisonSsPath, "05a-before-click");
        console.log(`  Baseline saved: ${saved}`);
      } else {
        const urls = attempt.allPages.map((p: any) => p.url());
        console.error("  Expected a page with github.com, but got:", urls);
        results.push({
          step: "Test 5: Click GitHub link",
          passed: false,
          screenshot: path.join(SCREENSHOT_DIR, "05b-new-tab.png"),
        });
        console.log("[Test 5] FAILED: GitHub page not found (even after self-heal).\n");
      }
    }

    // --------------------------------------------------
    // Summary
    // --------------------------------------------------
    console.log("=== Test Results ===\n");
    const failed = results.filter((r) => !r.passed);
    for (const r of results) {
      console.log(`  ${r.passed ? "PASS" : "FAIL"}  ${r.step}`);
      console.log(`        screenshot: ${r.screenshot}`);
    }
    console.log("");

    if (failed.length > 0) {
      console.log(`${failed.length} test(s) FAILED. Screenshots for failed steps:`);
      for (const f of failed) {
        console.log(`  -> ${f.step}`);
        console.log(`     ${f.screenshot}`);
      }
      process.exitCode = 1;
    } else {
      console.log("All tests passed!");
    }
    console.log(`\nAll screenshots saved to: ${SCREENSHOT_DIR}/`);
  } catch (error) {
    try {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "error-crash.png"),
        fullPage: true,
      });
      console.error(`\nCrash screenshot saved: ${SCREENSHOT_DIR}/error-crash.png`);
    } catch {}
    console.error("Test failed with error:", error);
    process.exitCode = 1;
  } finally {
    // 録画を停止してから動画を生成
    const totalFrames = await recorder.stop();
    console.log(`\n[Recording] Captured ${totalFrames} frames.`);

    await stagehand.close();

    if (totalFrames > 0) {
      const fps = Math.round(1000 / FRAME_INTERVAL_MS);
      console.log(`[Recording] Encoding video (${fps} fps)...`);
      const videoPath = framesToVideo(fps);
      if (videoPath) {
        console.log(`[Recording] Video saved: ${videoPath}`);
      }
    }
  }
}

main();
