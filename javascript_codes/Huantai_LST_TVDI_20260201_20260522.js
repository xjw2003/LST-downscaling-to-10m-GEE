/*
 * Google Earth Engine 中的桓台地表温度（LST）10 m 降尺度与 TVDI 计算脚本
 *
 * 用途
 * -------
 * 以 Landsat 8/9 Collection 2 Level-2 地表温度作为粗分辨率基础 LST，
 * 使用 Landsat 光谱波段和指数建立回归模型，再把该模型应用到
 * Sentinel-2 预测变量上，生成 10 m 分辨率的降尺度 LST 产品。
 * 随后基于 Sentinel-2 NDVI 与 10 m LST 构建 NDVI-LST 特征空间，
 * 拟合湿边和干边，计算温度植被干旱指数（TVDI）。
 *
 * 将整个脚本复制到 Google Earth Engine Code Editor 中运行：
 * https://code.earthengine.google.com/
 */

/*******************************************************************************
 * 1. 用户参数 - 将脚本用于其他研究区时，需要修改这些参数。
 ******************************************************************************/

// [需要修改：研究区]
// 桓台矢量边界资产。请确认你的 GEE 账号有权限读取该资产。
var ROI_ASSET = 'projects/python-478207/assets/huantai';
var roiFc = ee.FeatureCollection(ROI_ASSET);
var roi = roiFc.geometry();

// [需要修改：时间范围]
// GEE 的 filterDate 包含 START_DATE，但不包含 END_DATE。
// 这里设置为 2026-02-01 至 2026-05-22；为包含 2026-05-22，结束日期写作 2026-05-23。
var START_DATE = '2026-02-01';
var END_DATE = '2026-05-23';

// [需要修改：云量阈值]
// Landsat 使用 CLOUD_COVER 字段；Sentinel-2 使用 CLOUDY_PIXEL_PERCENTAGE 字段。
var LANDSAT_CLOUD_MAX = 30;
var SENTINEL2_CLOUD_MAX = 30;

// [需要修改：输出分辨率]
// 最终降尺度 LST 的导出分辨率。Sentinel-2 原生 B2/B3/B4/B8 波段为 10 m。
var OUTPUT_SCALE = 10;

// 回归模型在 Landsat 分辨率下拟合。
var REGRESSION_SCALE = 30;

// [需要修改：导出路径]
// 这里是 Export.image 使用的 Google Drive 文件夹和输出文件名前缀。
var EXPORT_FOLDER = 'GEE_LST_huantai';
var TVDI_EXPORT_PREFIX = 'huantai_TVDI_10m';

// [需要修改：自适应窗口覆盖判定]
// 1.0 表示严格要求覆盖率为 100%。考虑 ROI 边界、掩膜和重采样误差，
// 默认使用 0.99；如果需要更严格，可改成 0.995 或 1.0。
var COVERAGE_THRESHOLD = 0.99;
var COVERAGE_CHECK_SCALE = 30;
var MIN_SENTINEL2_IMAGES_FOR_WINDOW = 1;
var MIN_LANDSAT_IMAGES_FOR_WINDOW = 1;

// 导出坐标系。EPSG:4326 便于共享；如果后续需要做面积或距离等度量分析，
// 建议改用合适的投影坐标系。
var EXPORT_CRS = 'EPSG:4326';
var MAX_PIXELS = 1e13;

// [需要根据研究区调试：TVDI 参数]
// TVDI 公式：TVDI = (LST - LSTwet) / (LSTdry - LSTwet)。
// 这里按 NDVI 分箱，在每个分箱内用 LST 低分位数作为湿边点、高分位数作为干边点。
// 使用分位数而不是绝对最小/最大值，可以减少异常像元对边界拟合的影响。
var TVDI_NDVI_MIN = 0.05;
var TVDI_NDVI_MAX = 0.90;
var TVDI_NDVI_BIN_WIDTH = 0.05;
var TVDI_WET_PERCENTILE = 5;
var TVDI_DRY_PERCENTILE = 95;
var TVDI_MIN_PIXELS_PER_BIN = 30;

// TVDI 有效像元筛选。水体和异常温度会明显拉歪干湿边，必要时按本地情况调整。
var TVDI_LST_MIN = -20;
var TVDI_LST_MAX = 60;
var TVDI_NDWI_WATER_MAX = 0.30;
var TVDI_MIN_EDGE_GAP_C = 0.5;

// Landsat 回归和 Sentinel-2 应用中共同使用的预测变量。
// BLUE/GREEN/RED/NIR 在 Sentinel-2 中是原生 10 m 波段。SWIR1 对应 Sentinel-2 B11，
// 原生分辨率为 20 m，因此在 10 m 导出时 GEE 会进行重采样。NDBI 需要 SWIR1；
// 如果只想使用 Sentinel-2 原生 10 m 波段，可从列表中移除 SWIR1 和 NDBI。
var PREDICTOR_BANDS = [
  'BLUE',
  'GREEN',
  'RED',
  'NIR',
  'SWIR1',
  'NDVI',
  'NDWI',
  'NDBI'
];

/*******************************************************************************
 * 2. 辅助函数。
 ******************************************************************************/

// 对 Landsat Collection 2 Level-2 数据中的云、云影、卷云、积雪和饱和像元进行掩膜，
// 然后缩放光学反射率和热红外 LST。
function maskAndScaleLandsatC2L2(image) {
  var qa = image.select('QA_PIXEL');

  var clearMask = qa.bitwiseAnd(1 << 0).eq(0)  // 填充值
    .and(qa.bitwiseAnd(1 << 1).eq(0))          // 膨胀云
    .and(qa.bitwiseAnd(1 << 2).eq(0))          // 卷云
    .and(qa.bitwiseAnd(1 << 3).eq(0))          // 云
    .and(qa.bitwiseAnd(1 << 4).eq(0))          // 云影
    .and(qa.bitwiseAnd(1 << 5).eq(0));         // 雪

  var saturationMask = image.select('QA_RADSAT').eq(0);

  var optical = image.select('SR_B.')
    .multiply(0.0000275)
    .add(-0.2);

  // Landsat Collection 2 ST_B10 缩放系数：
  // 开尔文温度 = DN * 0.00341802 + 149.0；摄氏度 = 开尔文温度 - 273.15。
  var lstCelsius = image.select('ST_B10')
    .multiply(0.00341802)
    .add(149.0)
    .subtract(273.15)
    .rename('LST');

  return ee.Image(image.addBands(optical, null, true)
    .addBands(lstCelsius, null, true)
    .updateMask(clearMask)
    .updateMask(saturationMask)
    .copyProperties(image, ['system:time_start', 'SPACECRAFT_ID']));
}

// 更稳妥的归一化差值计算。ee.Image.normalizedDifference 在输入值为负时可能掩膜像元；
// Landsat C2 缩放后的反射率可能包含少量负值，所以这里显式写公式更合适。
function normalizedDifferenceSafe(image, highBand, lowBand, outputName) {
  return image.expression(
    '(high - low) / (high + low)',
    {
      high: image.select(highBand),
      low: image.select(lowBand)
    }
  ).rename(outputName);
}

// 构建 Landsat 预测变量。波段含义：
// BLUE: SR_B2，GREEN: SR_B3，RED: SR_B4，NIR: SR_B5，SWIR1: SR_B6。
function addLandsatPredictors(image) {
  var blue = image.select('SR_B2').rename('BLUE');
  var green = image.select('SR_B3').rename('GREEN');
  var red = image.select('SR_B4').rename('RED');
  var nir = image.select('SR_B5').rename('NIR');
  var swir1 = image.select('SR_B6').rename('SWIR1');

  var ndvi = normalizedDifferenceSafe(image, 'SR_B5', 'SR_B4', 'NDVI');
  var ndwi = normalizedDifferenceSafe(image, 'SR_B3', 'SR_B5', 'NDWI');
  var ndbi = normalizedDifferenceSafe(image, 'SR_B6', 'SR_B5', 'NDBI');

  return ee.Image(ee.Image.cat([
      blue, green, red, nir, swir1, ndvi, ndwi, ndbi, image.select('LST')
    ])
    .copyProperties(image, ['system:time_start', 'SPACECRAFT_ID']));
}

// 使用 SCL 波段掩膜 Sentinel-2 L2A Harmonized 数据中的云和云影。
function maskAndScaleSentinel2(image) {
  image = ee.Image(image);
  var scl = image.select('SCL');

  var clearMask = scl.neq(0)   // 无数据
    .and(scl.neq(1))           // 饱和或异常像元
    .and(scl.neq(3))           // 云影
    .and(scl.neq(8))           // 中概率云
    .and(scl.neq(9))           // 高概率云
    .and(scl.neq(10))          // 薄卷云
    .and(scl.neq(11));         // 雪或冰

  var scaled = image.select(['B2', 'B3', 'B4', 'B8', 'B11'])
    .multiply(0.0001);

  return ee.Image(image.addBands(scaled, null, true)
    .updateMask(clearMask)
    .copyProperties(image, ['system:time_start']));
}

// 构建 Sentinel-2 预测变量，并让名称与 Landsat 预测变量保持一致。
// B2/B3/B4/B8 是原生 10 m 波段。B11 是原生 20 m 波段，在 10 m 导出时由 GEE 重采样。
function addSentinel2Predictors(image) {
  image = ee.Image(image);
  var blue = image.select('B2').rename('BLUE');
  var green = image.select('B3').rename('GREEN');
  var red = image.select('B4').rename('RED');
  var nir = image.select('B8').rename('NIR');
  var swir1 = image.select('B11').resample('bicubic').rename('SWIR1');

  var ndvi = normalizedDifferenceSafe(image, 'B8', 'B4', 'NDVI');
  var ndwi = normalizedDifferenceSafe(image, 'B3', 'B8', 'NDWI');
  var ndbi = normalizedDifferenceSafe(image, 'B11', 'B8', 'NDBI');

  return ee.Image(ee.Image.cat([blue, green, red, nir, swir1, ndvi, ndwi, ndbi])
    .copyProperties(image, ['system:time_start']));
}

/*******************************************************************************
 * 3. 自适应时间窗口扫描。
 ******************************************************************************/

// 避免 Map.centerObject 对资产几何发起额外的 value:compute 请求。
// 桓台县附近中心点：118.1E, 36.95N。
Map.setCenter(118.1, 36.95, 9);
Map.addLayer(roi, {color: 'yellow'}, 'Huantai ROI', false);

var landsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2');
var landsat9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2');

var rawLandsatCollection = landsat8.merge(landsat9)
  .filterBounds(roi)
  .filter(ee.Filter.lte('CLOUD_COVER', LANDSAT_CLOUD_MAX));

var rawSentinel2Collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(roi)
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', SENTINEL2_CLOUD_MAX));

print('Study area asset:', ROI_ASSET);
print('Adaptive date range:', START_DATE, 'to', END_DATE, '(END_DATE is exclusive)');
print('Coverage threshold:', COVERAGE_THRESHOLD);

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function parseDateUtc(dateString) {
  var parts = dateString.split('-');
  return new Date(Date.UTC(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  ));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDateIso(date) {
  return date.getUTCFullYear() + '-' +
    pad2(date.getUTCMonth() + 1) + '-' +
    pad2(date.getUTCDate());
}

function formatDateTag(date) {
  return date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate());
}

var startDateClient = parseDateUtc(START_DATE);
var endDateExclusiveClient = parseDateUtc(END_DATE);
var exportedWindowCount = 0;

function getWindowCounts(windowStart, windowEndExclusive) {
  var landsatCount = rawLandsatCollection
    .filterDate(windowStart, windowEndExclusive)
    .size();
  var sentinel2Count = rawSentinel2Collection
    .filterDate(windowStart, windowEndExclusive)
    .size();

  return ee.Dictionary({
    landsat_count: landsatCount,
    sentinel2_count: sentinel2Count
  });
}

function buildSentinel2Composite(windowStart, windowEndExclusive) {
  var sentinel2Collection = rawSentinel2Collection
    .filterDate(windowStart, windowEndExclusive)
    .map(maskAndScaleSentinel2)
    .map(addSentinel2Predictors)
    .select(PREDICTOR_BANDS);

  return ee.Image(sentinel2Collection.median())
    .select(PREDICTOR_BANDS)
    .clip(roi);
}

function getSentinel2Coverage(windowStart, windowEndExclusive) {
  var sentinel2Composite = buildSentinel2Composite(windowStart, windowEndExclusive);
  var validMask = sentinel2Composite.select(['NDVI', 'NDWI'])
    .mask()
    .reduce(ee.Reducer.min())
    .rename('valid');

  var pixelArea = ee.Image.pixelArea().rename('area');
  var totalAreaValue = pixelArea.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi,
    scale: COVERAGE_CHECK_SCALE,
    maxPixels: MAX_PIXELS,
    tileScale: 4
  }).get('area');

  var validAreaValue = pixelArea.updateMask(validMask).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi,
    scale: COVERAGE_CHECK_SCALE,
    maxPixels: MAX_PIXELS,
    tileScale: 4
  }).get('area');

  var totalArea = ee.Number(totalAreaValue);
  var validArea = ee.Number(ee.Algorithms.If(validAreaValue, validAreaValue, 0));

  return ee.Dictionary({
    coverage_ratio: validArea.divide(totalArea),
    valid_area_m2: validArea,
    total_area_m2: totalArea
  });
}

/*******************************************************************************
 * 4. 对一个已满足覆盖条件的时间窗口计算 TVDI。
 ******************************************************************************/

function buildWindowTVDI(windowStart, windowEndExclusive) {
  var landsatCollection = rawLandsatCollection
    .filterDate(windowStart, windowEndExclusive)
    .map(maskAndScaleLandsatC2L2)
    .map(addLandsatPredictors)
    .select(PREDICTOR_BANDS.concat(['LST']));

  var sentinel2Collection = rawSentinel2Collection
    .filterDate(windowStart, windowEndExclusive)
    .map(maskAndScaleSentinel2)
    .map(addSentinel2Predictors)
    .select(PREDICTOR_BANDS);

  var landsatComposite = landsatCollection.median().clip(roi);
  var sentinel2Composite = sentinel2Collection.median().clip(roi);
  var coefficientNames = ['intercept'].concat(PREDICTOR_BANDS);

  var landsatConstant = ee.Image.constant(1)
    .rename('intercept')
    .setDefaultProjection(landsatComposite.select('BLUE').projection());

  var regressionInputs = landsatConstant
    .addBands(landsatComposite.select(PREDICTOR_BANDS))
    .addBands(landsatComposite.select('LST'));

  var regression = regressionInputs.reduceRegion({
    reducer: ee.Reducer.linearRegression({
      numX: PREDICTOR_BANDS.length + 1,
      numY: 1
    }),
    geometry: roi,
    scale: REGRESSION_SCALE,
    maxPixels: MAX_PIXELS,
    tileScale: 4
  });

  var coefficients = ee.Array(regression.get('coefficients')).project([0]);
  var coefficientImage = ee.Image.constant(coefficients.toList())
    .rename(coefficientNames);

  var landsatModelInputs = landsatConstant
    .addBands(landsatComposite.select(PREDICTOR_BANDS));

  var landsatPredicted30m = landsatModelInputs
    .multiply(coefficientImage)
    .reduce(ee.Reducer.sum())
    .rename('LST_model_30m')
    .clip(roi);

  var landsatResiduals30m = landsatComposite.select('LST')
    .subtract(landsatPredicted30m)
    .rename('LST_residual_30m')
    .clip(roi);

  var gaussianKernel = ee.Kernel.gaussian({
    radius: 1.5,
    sigma: 1,
    units: 'pixels',
    normalize: true
  });

  var landsatResiduals10m = landsatResiduals30m
    .resample('bicubic')
    .convolve(gaussianKernel)
    .rename('LST_residual_10m');

  var sentinel2Constant = ee.Image.constant(1)
    .rename('intercept')
    .setDefaultProjection(sentinel2Composite.select('BLUE').projection());

  var sentinel2ModelInputs = sentinel2Constant
    .addBands(sentinel2Composite.select(PREDICTOR_BANDS));

  var lst10mNoResiduals = sentinel2ModelInputs
    .multiply(coefficientImage)
    .reduce(ee.Reducer.sum())
    .rename('LST_10m_no_residuals')
    .clip(roi);

  var lst10mWithResiduals = lst10mNoResiduals
    .add(landsatResiduals10m)
    .rename('LST_10m_C')
    .clip(roi);

  var tvdiNdvi = sentinel2Composite.select('NDVI').rename('NDVI');
  var tvdiNdwi = sentinel2Composite.select('NDWI').rename('NDWI');
  var tvdiLst = lst10mWithResiduals.rename('LST');

  var tvdiValidMask = tvdiNdvi.gte(TVDI_NDVI_MIN)
    .and(tvdiNdvi.lte(TVDI_NDVI_MAX))
    .and(tvdiLst.gte(TVDI_LST_MIN))
    .and(tvdiLst.lte(TVDI_LST_MAX))
    .and(tvdiNdwi.lt(TVDI_NDWI_WATER_MAX));

  var tvdiBinStarts = ee.List.sequence(
    TVDI_NDVI_MIN,
    ee.Number(TVDI_NDVI_MAX).subtract(TVDI_NDVI_BIN_WIDTH),
    TVDI_NDVI_BIN_WIDTH
  );

  var tvdiEdgeSamples = ee.FeatureCollection(tvdiBinStarts.map(function(binStart) {
    binStart = ee.Number(binStart);
    var binEnd = binStart.add(TVDI_NDVI_BIN_WIDTH);
    var binMask = tvdiNdvi.gte(binStart).and(tvdiNdvi.lt(binEnd));
    var binLst = tvdiLst.updateMask(tvdiValidMask).updateMask(binMask);

    var edgePercentiles = binLst.reduceRegion({
      reducer: ee.Reducer.percentile(
        [TVDI_WET_PERCENTILE, TVDI_DRY_PERCENTILE],
        ['wet', 'dry']
      ),
      geometry: roi,
      scale: OUTPUT_SCALE,
      maxPixels: MAX_PIXELS,
      tileScale: 4
    });

    var binCount = binLst.reduceRegion({
      reducer: ee.Reducer.count(),
      geometry: roi,
      scale: OUTPUT_SCALE,
      maxPixels: MAX_PIXELS,
      tileScale: 4
    });

    return ee.Feature(null, {
      ndvi_mid: binStart.add(binEnd).divide(2),
      lst_wet: edgePercentiles.get('LST_wet'),
      lst_dry: edgePercentiles.get('LST_dry'),
      pixel_count: binCount.get('LST')
    });
  }))
    .filter(ee.Filter.notNull(['lst_wet', 'lst_dry', 'pixel_count']))
    .filter(ee.Filter.gte('pixel_count', TVDI_MIN_PIXELS_PER_BIN));

  var tvdiWetFit = tvdiEdgeSamples.reduceColumns(
    ee.Reducer.linearFit(),
    ['ndvi_mid', 'lst_wet']
  );
  var tvdiDryFit = tvdiEdgeSamples.reduceColumns(
    ee.Reducer.linearFit(),
    ['ndvi_mid', 'lst_dry']
  );

  var wetSlope = ee.Number(tvdiWetFit.get('scale'));
  var wetIntercept = ee.Number(tvdiWetFit.get('offset'));
  var drySlope = ee.Number(tvdiDryFit.get('scale'));
  var dryIntercept = ee.Number(tvdiDryFit.get('offset'));

  var lstWetEdge = tvdiNdvi.multiply(wetSlope)
    .add(wetIntercept)
    .rename('LST_wet_edge');
  var lstDryEdge = tvdiNdvi.multiply(drySlope)
    .add(dryIntercept)
    .rename('LST_dry_edge');
  var tvdiEdgeGap = lstDryEdge.subtract(lstWetEdge).rename('LST_edge_gap');

  return tvdiLst.subtract(lstWetEdge)
    .divide(tvdiEdgeGap)
    .rename('TVDI')
    .updateMask(tvdiValidMask)
    .updateMask(tvdiEdgeGap.gt(TVDI_MIN_EDGE_GAP_C))
    .clamp(0, 1)
    .clip(roi);
}

/*******************************************************************************
 * 5. 创建导出任务并按时间顺序继续扫描。
 ******************************************************************************/

var tvdiVis = {
  min: 0,
  max: 1,
  palette: [
    '2166ac', '67a9cf', 'd1e5f0', 'f7f7f7',
    'fddbc7', 'ef8a62', 'b2182b'
  ]
};

function createTVDIExport(windowStartDate, windowEndExclusiveDate, diagnostics) {
  var windowStart = formatDateIso(windowStartDate);
  var windowEndExclusive = formatDateIso(windowEndExclusiveDate);
  var windowEndInclusiveDate = addDays(windowEndExclusiveDate, -1);
  var suffix = formatDateTag(windowStartDate) + '_' + formatDateTag(windowEndInclusiveDate);
  var exportName = TVDI_EXPORT_PREFIX + '_' + suffix;
  var tvdi = buildWindowTVDI(windowStart, windowEndExclusive);

  print('Create TVDI export:', exportName, diagnostics);

  if (exportedWindowCount === 0) {
    Map.addLayer(tvdi, tvdiVis, 'Preview ' + exportName, true);
  }

  Export.image.toDrive({
    image: tvdi,
    description: exportName,
    folder: EXPORT_FOLDER,
    fileNamePrefix: exportName,
    region: roi,
    scale: OUTPUT_SCALE,
    crs: EXPORT_CRS,
    maxPixels: MAX_PIXELS,
    fileFormat: 'GeoTIFF',
    formatOptions: {
      cloudOptimized: true
    }
  });

  exportedWindowCount += 1;
}

function scanWindow(windowStartDate, windowEndExclusiveDate) {
  if (windowEndExclusiveDate.getTime() > endDateExclusiveClient.getTime()) {
    print(
      'No complete-coverage window found for start date:',
      formatDateIso(windowStartDate),
      'before END_DATE:',
      END_DATE
    );
    print('Adaptive TVDI export task count:', exportedWindowCount);
    return;
  }

  var windowStart = formatDateIso(windowStartDate);
  var windowEndExclusive = formatDateIso(windowEndExclusiveDate);

  getWindowCounts(windowStart, windowEndExclusive).evaluate(function(counts) {
    var landsatCount = counts ? counts.landsat_count : 0;
    var sentinel2Count = counts ? counts.sentinel2_count : 0;
    var nextEndExclusiveDate = addDays(windowEndExclusiveDate, 1);

    if (sentinel2Count < MIN_SENTINEL2_IMAGES_FOR_WINDOW ||
        landsatCount < MIN_LANDSAT_IMAGES_FOR_WINDOW) {
      print(
        'Window not enough images:',
        windowStart,
        'to',
        windowEndExclusive,
        counts
      );
      scanWindow(windowStartDate, nextEndExclusiveDate);
      return;
    }

    getSentinel2Coverage(windowStart, windowEndExclusive).evaluate(function(coverage) {
      var ratio = coverage ? Number(coverage.coverage_ratio) : 0;
      var diagnostics = {
        window_start: windowStart,
        window_end_exclusive: windowEndExclusive,
        window_end_inclusive: formatDateIso(addDays(windowEndExclusiveDate, -1)),
        landsat_count: landsatCount,
        sentinel2_count: sentinel2Count,
        coverage_ratio: ratio
      };

      if (ratio >= COVERAGE_THRESHOLD) {
        createTVDIExport(windowStartDate, windowEndExclusiveDate, diagnostics);
        findNextWindow(windowEndExclusiveDate);
      } else {
        print('Window coverage not enough:', diagnostics);
        scanWindow(windowStartDate, nextEndExclusiveDate);
      }
    });
  });
}

function findNextWindow(windowStartDate) {
  if (windowStartDate.getTime() >= endDateExclusiveClient.getTime()) {
    print('Adaptive TVDI export task count:', exportedWindowCount);
    print('Finished adaptive TVDI window scan.');
    return;
  }

  scanWindow(windowStartDate, addDays(windowStartDate, 1));
}

findNextWindow(startDateClient);
