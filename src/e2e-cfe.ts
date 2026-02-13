import { z } from "zod";
import path from "path";
import fs from "fs";
import {
  setupTestEnv,
  teardownTestEnv,
  TestResult,
  SCREENSHOT_DIR,
  BASELINES_DIR,
  VISUAL_DIFF_THRESHOLD,
} from "./helpers/test-runner.js";
import { compareWithBaseline, saveBaseline } from "./helpers/screenshot.js";

/**
 * E2E Test: https://cfe.jp/ (uzulla's profile page)
 *
 * 各ステップでスクリーンショットを保存し、失敗時にどのステップで
 * 何が起きたかを視覚的に確認できるようにする。
 * テスト全体の動画も recordings/ に保存する。
 */

async function main() {
  console.log("=== Stagehand E2E Test: https://cfe.jp/ ===\n");

  const { ctx, recorder } = await setupTestEnv();
  const results: TestResult[] = [];

  try {
    // --------------------------------------------------
    // Test 1: Navigate to the page
    // --------------------------------------------------
    console.log("[Test 1] Navigating to https://cfe.jp/ ...");
    await ctx.page.goto("https://cfe.jp/");
    await ctx.page.waitForLoadState("networkidle");
    const ss1 = await ctx.screenshot("01-page-loaded");
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
    const profile = await ctx.stagehand.extract(
      "Extract the person's name, their job title or description, and a list of their SNS/social media link labels (e.g., Twitter, GitHub, etc.)",
      profileSchema
    );
    console.log("  Name:", profile.name);
    console.log("  Description:", profile.description);
    console.log("  SNS Links:", profile.snsLinks.join(", "));

    const ss2 = await ctx.screenshot("02-profile-extracted");
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
    const books = await ctx.stagehand.extract(
      "Extract information about the books (著書) listed on this page, including the title and a short description for each book.",
      booksSchema
    );
    console.log(`  Found ${books.books.length} book(s):`);
    for (const book of books.books) {
      console.log(`    - "${book.title}": ${book.description}`);
    }

    const ss3 = await ctx.screenshot("03-books-extracted");
    const test3Passed = books.books.length > 0;
    results.push({ step: "Test 3: Book extraction", passed: test3Passed, screenshot: ss3 });
    console.log(
      `[Test 3] ${test3Passed ? "PASSED" : "FAILED"}: Book extraction.\n`
    );

    // --------------------------------------------------
    // Test 4: Observe clickable links on the page
    // --------------------------------------------------
    console.log("[Test 4] Observing clickable links on the page ...");
    const actions = await ctx.stagehand.observe(
      "Find all clickable links on this page"
    );
    console.log(`  Found ${actions.length} actionable elements.`);
    for (const action of actions.slice(0, 5)) {
      console.log(`    - ${action.description} [${action.method}]`);
    }
    if (actions.length > 5) {
      console.log(`    ... and ${actions.length - 5} more.`);
    }

    const ss4 = await ctx.screenshot("04-links-observed");
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
    await ctx.page.screenshot({ path: comparisonSsPath });
    console.log(`  Pre-click screenshot: ${comparisonSsPath}`);

    // ベースラインとの比較
    const diffPath = path.join(SCREENSHOT_DIR, "05a-diff.png");
    const comparison = compareWithBaseline(comparisonSsPath, "05a-before-click", {
      baselinesDir: BASELINES_DIR,
      diffPath,
    });

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
        const pagesBefore = ctx.stagehand.context.pages().length;
        await ctx.stagehand.act("Click the GitHub link");

        // 新タブが開くのを待つ（最大5秒ポーリング）
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const current = ctx.stagehand.context.pages();
          if (current.length > pagesBefore) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        // 少し待って URL が確定するのを待つ
        await new Promise((r) => setTimeout(r, 1000));

        const allPages = ctx.stagehand.context.pages();
        // 新タブで開いた場合 or 同じタブで遷移した場合の両方を検出
        const githubPage = allPages.find((p: any) => p.url().includes("github.com"));
        const navigatedInPlace = ctx.page.url().includes("github.com");
        return {
          success: !!githubPage || navigatedInPlace,
          githubPage: githubPage || (navigatedInPlace ? ctx.page : null),
          allPages,
        };
      };

      let attempt = await actAndAssert();

      if (!attempt.success) {
        // アサーション失敗 → セルフヒール: キャッシュ削除して再試行
        console.log("  GitHub page not found after act(). Attempting self-heal...");

        // 間違って開いたタブを閉じる
        const extraPages = attempt.allPages.filter((p: any) => p !== ctx.page);
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
        await ctx.page.goto("https://cfe.jp/");
        await ctx.page.waitForLoadState("networkidle");
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
      if (newTab !== ctx.page) {
        await newTab.waitForLoadState("domcontentloaded").catch(() => {});
        const newTabSs = await ctx.screenshot("05b-new-tab", newTab);
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
        const saved = saveBaseline(comparisonSsPath, "05a-before-click", BASELINES_DIR);
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
  } catch (error) {
    try {
      await ctx.page.screenshot({
        path: path.join(SCREENSHOT_DIR, "error-crash.png"),
        fullPage: true,
      });
      console.error(`\nCrash screenshot saved: ${SCREENSHOT_DIR}/error-crash.png`);
    } catch {}
    console.error("Test failed with error:", error);
    process.exitCode = 1;
  } finally {
    await teardownTestEnv(ctx, recorder, results);
  }
}

main();
