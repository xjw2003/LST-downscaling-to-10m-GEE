/*
 * Qingdao LST downscaling to 10 m in Google Earth Engine
 *
 * Purpose
 * -------
 * Use Landsat 8/9 Collection 2 Level-2 land surface temperature as the
 * coarse-resolution base LST, build a regression model with Landsat spectral
 * bands and indices, then apply the model to Sentinel-2 predictors to produce
 * a 10 m downscaled LST product.
 *
 * Copy this whole script into the Google Earth Engine Code Editor:
 * https://code.earthengine.google.com/
 */

/*******************************************************************************
 * 1. User parameters - edit these when applying the script to another study.
 ******************************************************************************/

// [NEED TO MODIFY: study area]
// Qingdao shapefile asset. Make sure your GEE account has permission to read it.
var ROI_ASSET = 'projects/python-478207/assets/qingdaoshp_wheat';
var roiFc = ee.FeatureCollection(ROI_ASSET);
var roi = roiFc.geometry();

// [NEED TO MODIFY: time range]
// GEE filterDate includes START_DATE and excludes END_DATE. To include
// 2026-05-15, set END_DATE to 2026-05-16.
var START_DATE = '2026-02-01';
var END_DATE = '2026-05-16';

// [NEED TO MODIFY: cloud thresholds]
// Landsat uses CLOUD_COVER. Sentinel-2 uses CLOUDY_PIXEL_PERCENTAGE.
var LANDSAT_CLOUD_MAX = 30;
var SENTINEL2_CLOUD_MAX = 30;

// [NEED TO MODIFY: output resolution]
// Final downscaled LST export scale. Sentinel-2 native B2/B3/B4/B8 are 10 m.
var OUTPUT_SCALE = 10;

// Regression is fitted at Landsat resolution.
var REGRESSION_SCALE = 30;

// [NEED TO MODIFY: export path]
// This is the Google Drive folder and output file prefix used by Export.image.
var EXPORT_FOLDER = 'GEE_LST_Qingdao';
var EXPORT_DESCRIPTION = 'Qingdao_LST_10m_20260201_20260515';
var EXPORT_FILE_PREFIX = 'Qingdao_LST_10m_20260201_20260515';

// Export CRS. EPSG:4326 is convenient for sharing; use a projected CRS if your
// downstream area/metric analysis requires it.
var EXPORT_CRS = 'EPSG:4326';
var MAX_PIXELS = 1e13;

// Predictors used in both the Landsat regression and Sentinel-2 application.
// BLUE/GREEN/RED/NIR are native 10 m in Sentinel-2. SWIR1 is Sentinel-2 B11
// and is native 20 m, so GEE will resample it when exporting at 10 m. NDBI
// requires SWIR1; remove SWIR1 and NDBI from this list if you want only native
// Sentinel-2 10 m bands.
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
 * 2. Helper functions.
 ******************************************************************************/

// Mask clouds, cloud shadows, cirrus, snow and saturated pixels in Landsat
// Collection 2 Level-2 data, then scale optical reflectance and thermal LST.
function maskAndScaleLandsatC2L2(image) {
  var qa = image.select('QA_PIXEL');

  var clearMask = qa.bitwiseAnd(1 << 0).eq(0)  // fill
    .and(qa.bitwiseAnd(1 << 1).eq(0))          // dilated cloud
    .and(qa.bitwiseAnd(1 << 2).eq(0))          // cirrus
    .and(qa.bitwiseAnd(1 << 3).eq(0))          // cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0))          // cloud shadow
    .and(qa.bitwiseAnd(1 << 5).eq(0));         // snow

  var saturationMask = image.select('QA_RADSAT').eq(0);

  var optical = image.select('SR_B.')
    .multiply(0.0000275)
    .add(-0.2);

  // Landsat Collection 2 ST_B10 scale factor:
  // Kelvin = DN * 0.00341802 + 149.0; Celsius = Kelvin - 273.15.
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

// Safer normalized difference. ee.Image.normalizedDifference can mask pixels
// when an input value is negative; Landsat C2 scaled reflectance can contain
// small negative values, so an explicit expression is preferable here.
function normalizedDifferenceSafe(image, highBand, lowBand, outputName) {
  return image.expression(
    '(high - low) / (high + low)',
    {
      high: image.select(highBand),
      low: image.select(lowBand)
    }
  ).rename(outputName);
}

// Build Landsat predictors. Band meanings:
// BLUE: SR_B2, GREEN: SR_B3, RED: SR_B4, NIR: SR_B5, SWIR1: SR_B6.
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

// Mask clouds and cloud shadows in Sentinel-2 L2A Harmonized using the SCL band.
function maskAndScaleSentinel2(image) {
  var scl = image.select('SCL');

  var clearMask = scl.neq(0)   // no data
    .and(scl.neq(1))           // saturated or defective
    .and(scl.neq(3))           // cloud shadow
    .and(scl.neq(8))           // medium probability cloud
    .and(scl.neq(9))           // high probability cloud
    .and(scl.neq(10))          // thin cirrus
    .and(scl.neq(11));         // snow or ice

  var scaled = image.select(['B2', 'B3', 'B4', 'B8', 'B11'])
    .multiply(0.0001);

  return image.addBands(scaled, null, true)
    .updateMask(clearMask)
    .copyProperties(image, ['system:time_start']);
}

// Build Sentinel-2 predictors matching the Landsat predictor names.
// B2/B3/B4/B8 are native 10 m. B11 is native 20 m and is resampled by GEE
// during 10 m export.
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
 * 3. Load and prepare image collections.
 ******************************************************************************/

Map.centerObject(roi, 9);
Map.addLayer(roi, {color: 'yellow'}, 'Qingdao ROI', false);

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

// Median composites reduce cloud gaps over the selected period. If you need a
// single-date LST, narrow START_DATE and END_DATE around the image date.
var landsatComposite = landsatCollection.median().clip(roi);
var sentinel2Composite = sentinel2Collection.median().clip(roi);

/*******************************************************************************
 * 4. Fit Landsat LST regression and apply it to Sentinel-2 at 10 m.
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

// Landsat model at 30 m, used to compute regression residuals.
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

// Smooth and resample Landsat residuals before adding them back to the 10 m
// Sentinel-2-based estimate. This follows the original project logic.
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

// Apply the Landsat-trained coefficients to Sentinel-2 predictors.
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

// Final 10 m LST result in degrees Celsius.
var lst10mWithResiduals = lst10mNoResiduals
  .add(landsatResiduals10m)
  .rename('LST_10m_C')
  .clip(roi);

/*******************************************************************************
 * 5. Display layers and diagnostic summaries.
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

/*******************************************************************************
 * 6. Export final 10 m LST.
 ******************************************************************************/

// [NEED TO MODIFY: export path, output resolution]
// Start this task manually from the Code Editor Tasks tab.
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

// Optional export: model-only 10 m LST without residual correction.
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
