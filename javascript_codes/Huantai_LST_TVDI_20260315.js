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
// 本脚本针对 2026-03-15 附近，使用目标日前后 7 天的影像窗口。
var TARGET_DATE = '2026-03-15';
var START_DATE = '2026-03-08';
var END_DATE = '2026-03-23';

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
var EXPORT_DESCRIPTION = 'huantai_LST_10m_20260315';
var EXPORT_FILE_PREFIX = 'huantai_LST_10m_20260315';
var TVDI_EXPORT_DESCRIPTION = 'huantai_TVDI_10m_20260315';
var TVDI_EXPORT_FILE_PREFIX = 'huantai_TVDI_10m_20260315';

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

  return image.addBands(optical, null, true)
    .addBands(lstCelsius, null, true)
    .updateMask(clearMask)
    .updateMask(saturationMask)
    .copyProperties(image, ['system:time_start', 'SPACECRAFT_ID']);
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

  return ee.Image.cat([
      blue, green, red, nir, swir1, ndvi, ndwi, ndbi, image.select('LST')
    ])
    .copyProperties(image, ['system:time_start', 'SPACECRAFT_ID']);
}

// 使用 SCL 波段掩膜 Sentinel-2 L2A Harmonized 数据中的云和云影。
function maskAndScaleSentinel2(image) {
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

  return image.addBands(scaled, null, true)
    .updateMask(clearMask)
    .copyProperties(image, ['system:time_start']);
}

// 构建 Sentinel-2 预测变量，并让名称与 Landsat 预测变量保持一致。
// B2/B3/B4/B8 是原生 10 m 波段。B11 是原生 20 m 波段，在 10 m 导出时由 GEE 重采样。
function addSentinel2Predictors(image) {
  var blue = image.select('B2').rename('BLUE');
  var green = image.select('B3').rename('GREEN');
  var red = image.select('B4').rename('RED');
  var nir = image.select('B8').rename('NIR');
  var swir1 = image.select('B11').resample('bicubic').rename('SWIR1');

  var ndvi = normalizedDifferenceSafe(image, 'B8', 'B4', 'NDVI');
  var ndwi = normalizedDifferenceSafe(image, 'B3', 'B8', 'NDWI');
  var ndbi = normalizedDifferenceSafe(image, 'B11', 'B8', 'NDBI');

  return ee.Image.cat([blue, green, red, nir, swir1, ndvi, ndwi, ndbi])
    .copyProperties(image, ['system:time_start']);
}

/*******************************************************************************
 * 3. 加载并预处理影像集合。
 ******************************************************************************/

Map.centerObject(roi, 9);
Map.addLayer(roi, {color: 'yellow'}, 'Huantai ROI', false);

var landsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2');
var landsat9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2');

var landsatCollection = landsat8.merge(landsat9)
  .filterBounds(roi)
  .filterDate(START_DATE, END_DATE)
  .filter(ee.Filter.lte('CLOUD_COVER', LANDSAT_CLOUD_MAX))
  .map(maskAndScaleLandsatC2L2)
  .map(addLandsatPredictors)
  .select(PREDICTOR_BANDS.concat(['LST']));

var sentinel2Collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(roi)
  .filterDate(START_DATE, END_DATE)
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', SENTINEL2_CLOUD_MAX))
  .map(maskAndScaleSentinel2)
  .map(addSentinel2Predictors)
  .select(PREDICTOR_BANDS);

print('Study area asset:', ROI_ASSET);
print('Date range used:', START_DATE, 'to', END_DATE, '(END_DATE is exclusive)');
print('Landsat 8/9 image count:', landsatCollection.size());
print('Sentinel-2 image count:', sentinel2Collection.size());
print('Landsat collection:', landsatCollection);
print('Sentinel-2 collection:', sentinel2Collection);

// 中值合成可以减少所选时间段内的云空洞。如果需要单日期 LST，
// 请把 START_DATE 和 END_DATE 缩小到目标影像日期附近。
var landsatComposite = landsatCollection.median().clip(roi);
var sentinel2Composite = sentinel2Collection.median().clip(roi);

/*******************************************************************************
 * 4. 拟合 Landsat LST 回归模型，并应用到 10 m Sentinel-2 数据。
 ******************************************************************************/

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

print('Regression coefficients:',
  ee.Dictionary.fromLists(coefficientNames, coefficients.toList()));

// 30 m Landsat 模型，用于计算回归残差。
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

// 在把 Landsat 残差加回基于 Sentinel-2 的 10 m 估计值之前，
// 先对残差进行平滑和重采样。这里沿用原项目的处理逻辑。
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

// 将用 Landsat 训练得到的系数应用到 Sentinel-2 预测变量。
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

// 最终 10 m LST 结果，单位为摄氏度。
var lst10mWithResiduals = lst10mNoResiduals
  .add(landsatResiduals10m)
  .rename('LST_10m_C')
  .clip(roi);

/*******************************************************************************
 * 5. 基于 10 m LST 和 Sentinel-2 NDVI 计算 TVDI。
 ******************************************************************************/

var tvdiNdvi = sentinel2Composite.select('NDVI').rename('NDVI');
var tvdiNdwi = sentinel2Composite.select('NDWI').rename('NDWI');
var tvdiLst = lst10mWithResiduals.rename('LST');

// 只保留适合构建 NDVI-LST 特征空间的像元：
// 1) NDVI 在指定范围内；2) LST 在合理范围内；3) 排除高 NDWI 的疑似水体。
var tvdiValidMask = tvdiNdvi.gte(TVDI_NDVI_MIN)
  .and(tvdiNdvi.lte(TVDI_NDVI_MAX))
  .and(tvdiLst.gte(TVDI_LST_MIN))
  .and(tvdiLst.lte(TVDI_LST_MAX))
  .and(tvdiNdwi.lt(TVDI_NDWI_WATER_MAX));

var tvdiInput = tvdiNdvi
  .addBands(tvdiLst)
  .updateMask(tvdiValidMask)
  .clip(roi);

var tvdiBinStarts = ee.List.sequence(
  TVDI_NDVI_MIN,
  ee.Number(TVDI_NDVI_MAX).subtract(TVDI_NDVI_BIN_WIDTH),
  TVDI_NDVI_BIN_WIDTH
);

// 每个 NDVI 分箱提取一个湿边点和一个干边点。
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

// 拟合湿边和干边：
// LSTwet = wet_slope * NDVI + wet_intercept
// LSTdry = dry_slope * NDVI + dry_intercept
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

var tvdi = tvdiLst.subtract(lstWetEdge)
  .divide(tvdiEdgeGap)
  .rename('TVDI')
  .updateMask(tvdiValidMask)
  .updateMask(tvdiEdgeGap.gt(TVDI_MIN_EDGE_GAP_C))
  .clamp(0, 1)
  .clip(roi);

print('TVDI NDVI-LST edge samples:', tvdiEdgeSamples);
print('TVDI wet edge coefficients:',
  ee.Dictionary({slope: wetSlope, intercept: wetIntercept}));
print('TVDI dry edge coefficients:',
  ee.Dictionary({slope: drySlope, intercept: dryIntercept}));

/*******************************************************************************
 * 6. 显示图层和诊断统计。
 ******************************************************************************/

var lstStats = lst10mWithResiduals.reduceRegion({
  reducer: ee.Reducer.minMax().combine({
    reducer2: ee.Reducer.mean(),
    sharedInputs: true
  }),
  geometry: roi,
  scale: OUTPUT_SCALE,
  maxPixels: MAX_PIXELS,
  tileScale: 4
});

print('Final 10 m LST statistics (degree Celsius):', lstStats);

var tvdiStats = tvdi.reduceRegion({
  reducer: ee.Reducer.minMax().combine({
    reducer2: ee.Reducer.mean(),
    sharedInputs: true
  }),
  geometry: roi,
  scale: OUTPUT_SCALE,
  maxPixels: MAX_PIXELS,
  tileScale: 4
});

print('TVDI statistics:', tvdiStats);

var tvdiScatterSamples = tvdiInput.sample({
  region: roi,
  scale: OUTPUT_SCALE,
  numPixels: 5000,
  seed: 20260515,
  geometries: false,
  tileScale: 4
});

var tvdiScatterChart = ui.Chart.feature.byFeature(
    tvdiScatterSamples,
    'NDVI',
    ['LST']
  )
  .setChartType('ScatterChart')
  .setOptions({
    title: 'NDVI-LST feature space for TVDI',
    hAxis: {title: 'NDVI'},
    vAxis: {title: 'LST (degree Celsius)'},
    pointSize: 1,
    legend: {position: 'none'}
  });
print(tvdiScatterChart);

var lstVis = {
  min: 0,
  max: 35,
  palette: [
    '040274', '235cb1', '307ef3', '30c8e2',
    'fff705', 'ffd611', 'ff8b13', 'ff500d',
    'ff0000', 'a71001'
  ]
};

var residualVis = {
  min: -5,
  max: 5,
  palette: ['2166ac', 'f7f7f7', 'b2182b']
};

var ndviVis = {
  min: TVDI_NDVI_MIN,
  max: TVDI_NDVI_MAX,
  palette: ['b2182b', 'f7f7f7', '1a9850']
};

var tvdiVis = {
  min: 0,
  max: 1,
  palette: [
    '2166ac', '67a9cf', 'd1e5f0', 'f7f7f7',
    'fddbc7', 'ef8a62', 'b2182b'
  ]
};

Map.addLayer(
  sentinel2Composite,
  {bands: ['RED', 'GREEN', 'BLUE'], min: 0.02, max: 0.3},
  'Sentinel-2 RGB composite',
  false
);
Map.addLayer(landsatComposite.select('LST'), lstVis, 'Landsat 8/9 LST composite 30 m', false);
Map.addLayer(landsatResiduals30m, residualVis, 'Landsat regression residuals 30 m', false);
Map.addLayer(lst10mNoResiduals, lstVis, 'LST 10 m no residuals', false);
Map.addLayer(lst10mWithResiduals, lstVis, 'Final LST 10 m with residuals', true);
Map.addLayer(tvdiNdvi.updateMask(tvdiValidMask), ndviVis, 'Sentinel-2 NDVI for TVDI', false);
Map.addLayer(lstWetEdge.updateMask(tvdiValidMask), lstVis, 'TVDI wet edge LST', false);
Map.addLayer(lstDryEdge.updateMask(tvdiValidMask), lstVis, 'TVDI dry edge LST', false);
Map.addLayer(tvdi, tvdiVis, 'TVDI 10 m', true);

/*******************************************************************************
 * 7. 导出最终 10 m LST 和 TVDI。
 ******************************************************************************/

// [需要修改：导出路径、输出分辨率]
// 需要在 Code Editor 的 Tasks 面板中手动启动该导出任务。
Export.image.toDrive({
  image: lst10mWithResiduals,
  description: EXPORT_DESCRIPTION,
  folder: EXPORT_FOLDER,
  fileNamePrefix: EXPORT_FILE_PREFIX,
  region: roi,
  scale: OUTPUT_SCALE,
  crs: EXPORT_CRS,
  maxPixels: MAX_PIXELS,
  fileFormat: 'GeoTIFF',
  formatOptions: {
    cloudOptimized: true
  }
});

// 导出 TVDI。TVDI 越接近 0，表示越湿润；越接近 1，表示越干旱。
Export.image.toDrive({
  image: tvdi,
  description: TVDI_EXPORT_DESCRIPTION,
  folder: EXPORT_FOLDER,
  fileNamePrefix: TVDI_EXPORT_FILE_PREFIX,
  region: roi,
  scale: OUTPUT_SCALE,
  crs: EXPORT_CRS,
  maxPixels: MAX_PIXELS,
  fileFormat: 'GeoTIFF',
  formatOptions: {
    cloudOptimized: true
  }
});

// 可选导出：仅模型估计的 10 m LST，不包含残差校正。
// Export.image.toDrive({
//   image: lst10mNoResiduals,
//   description: EXPORT_DESCRIPTION + '_no_residuals',
//   folder: EXPORT_FOLDER,
//   fileNamePrefix: EXPORT_FILE_PREFIX + '_no_residuals',
//   region: roi,
//   scale: OUTPUT_SCALE,
//   crs: EXPORT_CRS,
//   maxPixels: MAX_PIXELS,
//   fileFormat: 'GeoTIFF',
//   formatOptions: {
//     cloudOptimized: true
//   }
// });
