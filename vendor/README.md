# vendor/

`acad-ts-3.9.0.min.js`:@node-projects/acad-ts 3.9.0(MIT)的瀏覽器 bundle,約 1.0 MB(gzip 約 215 KB)。
ES module,匯出 `DwgReader`、`DxfReader`。

重新產生:
```
npm i @node-projects/acad-ts@3.9.0 esbuild
echo "export { DwgReader, DxfReader } from '@node-projects/acad-ts';" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --keep-names --platform=browser --target=safari15 --outfile=acad-ts-3.9.0.min.js
```
注意(實測,2026-11-24):
・ **一定要加 `--keep-names`。** acad-ts 內部有依類別名稱運作的地方。沒加時 DXF 會讀錯:`$INSUNITS` 讀成 0、LINE 終點全變 0(合成測資 tests/fixtures/mini.dxf 可重現);不壓縮的 bundle 也有同樣問題(esbuild 為避免重名會改類別名)。只有 `--minify --keep-names` 的結果與未打包的 npm 套件一致。
・ 我們自己的程式碼不依賴類別名稱:分派用 `subclassMarker`。
