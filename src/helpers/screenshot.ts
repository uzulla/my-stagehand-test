import path from "path";
import fs from "fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type ScreenshotFn = (name: string, targetPage?: any) => Promise<string>;

/**
 * スクリーンショット撮影ヘルパーを生成する。
 * 返り値の関数は名前を受け取ってスクリーンショットを保存し、ファイルパスを返す。
 */
export function createScreenshotHelper(
  page: any,
  dir: string
): ScreenshotFn {
  return async (name: string, targetPage = page) => {
    const filePath = path.join(dir, `${name}.png`);
    try {
      await targetPage.screenshot({ path: filePath, fullPage: true });
    } catch {
      await targetPage.screenshot({ path: filePath });
    }
    return filePath;
  };
}

/**
 * 2枚の PNG スクリーンショットを比較し、差異の割合と diff 画像を返す。
 * ベースラインが存在しない場合は比較をスキップ。
 */
export function compareWithBaseline(
  currentPath: string,
  baselineName: string,
  opts: { baselinesDir: string; diffPath: string }
): { mismatchRatio: number; diffSaved: boolean; skipped: boolean } {
  const baselinePath = path.join(opts.baselinesDir, `${baselineName}.png`);

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
  fs.writeFileSync(opts.diffPath, PNG.sync.write(diff));
  return { mismatchRatio, diffSaved: true, skipped: false };
}

/**
 * 現在のスクリーンショットをベースラインとして保存する。
 */
export function saveBaseline(
  screenshotPath: string,
  baselineName: string,
  baselinesDir: string
): string {
  if (!fs.existsSync(baselinesDir)) {
    fs.mkdirSync(baselinesDir, { recursive: true });
  }
  const dest = path.join(baselinesDir, `${baselineName}.png`);
  fs.copyFileSync(screenshotPath, dest);
  return dest;
}
