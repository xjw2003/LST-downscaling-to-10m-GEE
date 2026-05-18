/*
作者：Onačillová, K., Gallay, M., Paluba, D., Péliová, A., Tokarčík, O., Laubertová, D. 
（更多信息请联系：katarina.onacillova@upjs.sk）

本代码免费且开源。 
使用本代码及其派生数据时， 
请在相关发表成果中引用以下文献：
 
    Onačillová, K., Gallay, M., Paluba, D., Péliová, A., Tokarčík, O., Laubertová, D. 2022: 
    在 Google Earth Engine 中结合 Landsat 8 与 Sentinel 2 数据，
    生成城市环境中更高分辨率的地表温度图

本函数根据用户输入选择 Landsat 8 和 Sentinel 2 数据，
并执行地表温度（LST）降尺度。

###########################################################################################################################################################################
*/

// 设置用于显示的面板和控件。
// 设置标题和摘要控件。

// // 绘图工具
// var drawingTools = Map.drawingTools();

// // 直接在绘图工具上使用 addLayer 方法。
// var geometries = [ee.Geometry.Polygon(
//         [[[21.134189623651263, 48.82947658234015],
//           [21.134189623651263, 48.57888560664585],
//           [21.433567065057513, 48.57888560664585],
//           [21.433567065057513, 48.82947658234015]]], null, false)];

// drawingTools.addLayer(geometries, 'my_geometry1', 'red');
// 设置可用的绘制模式；点和线模式也可以启用。

var map = ui.Map();
// drawingTools() 会向地图添加绘图工具，因此这里会返回 true。
map.drawingTools().setDrawModes(["polygon", "rectangle"])
// 用新建的地图替换默认 Map。
ui.root.widgets().reset([map]);

// 应用标题。
var header = ui.Label('Landsat Land Surface Temperature downscaling using Sentinel-2', {fontSize: '23px', fontWeight: 'bold', color: '77797e'});

// 应用摘要。
var text = ui.Label(
  'Landsat land surface temperature downscaled at 10 m by Sentinel-2 data. ' +
  'Developed for urban management.',
    {fontSize: '15px'});

// 第二个标题。
var header2 = ui.Label('How to cite:', {fontSize: '16px', fontWeight: 'bold', margin:'0px 0px -5px 8px'});

// 第二段摘要。
var text2 = ui.Label(
  'Onačillová, K.; Gallay, M.; Paluba, D.; Péliová, A.; Tokarčík, O.; Laubertová, D. Combining Landsat 8 and Sentinel-2 Data in Google Earth Engine to Derive Higher Resolution Land Surface Temperature Maps in Urban Environment. Remote Sens. 2022, 14, 4076.',
    {fontSize: '15px', margin:'5px 0px 0px 8px'});

var textLink = ui.Label(' https://doi.org/10.3390/rs14164076',
  {fontSize: '15px', margin:'0px 0px 0px 8px',color:'blue'})
  .setUrl('https://doi.org/10.3390/rs14164076');
  
// 创建用于放置文字的面板。
var panel = ui.Panel({
  widgets:[header, text, header2],// 添加标题和文字。
  style:{width: '500px',position:'middle-right', margin: '10px'}});

panel.add(text2)
panel.add(textLink)  

// 创建用于附加文字和分隔线的变量。

// 创建另一个面板，用来放置分隔线和用户说明。
var intro = ui.Panel([
  ui.Label({
    value: '__________________________________________________________',
    style: {fontWeight: 'bold',  color: '77797e'},
  })]);

// 将该面板添加到更大的主面板中。
panel.add(intro)

// 将主面板添加到 GUI 根节点。
ui.root.insert(1,panel)



// 在界面中定义开始日期和结束日期。
var dateLabel = ui.Label({
    value:'Select start and end dates to find a proper L8/9 and S2 image pair',
    style: {fontWeight: 'bold', fontSize: '14px', margin: '10px 5px'}
  })

var startLabel = ui.Label({
    value:'Start date',
    style: {margin: '0 55px 0 10px',fontSize: '12px',color: 'gray'}
  })
var endLabel = ui.Label({
    value:'End date',
    style: {margin: '0 0px 0 10px',fontSize: '12px',color: 'gray'}
  })
var startDate_selected = ui.Textbox({placeholder: 'Start Date',  value: '2018-08-21',
  style: {width: '100px'}});
var endDate_selected = ui.Textbox({placeholder: 'End Date',  value: '2018-08-27',
  style: {width: '100px'}});
  
var Landsat_collection_label = ui.Label('Choose a Landsat Collection',
  {fontWeight: 'bold', fontSize: '14px', margin:'5px 0px 0px 8px'});

var cloudSliderLabel = ui.Label('Set the maximum cloud coverage (in %)',
  {fontWeight: 'bold', fontSize: '14px', margin:'5px 0px 0px 8px'});

// 定义 Landsat 8 和 9 影像集合的标签。
var L8 = 'Landsat 8 Image Collection',
    L9 = 'Landsat 9 Image Collection';

// 定义选择 AOI/影像集合的下拉控件。
var selectCollection = ui.Select({
  items:[L8,L9],
  placeholder:'Select Landsat Collection',value: 'Landsat 8 Image Collection'
  });

function setLandsatCollection(){
  LCOll = selectCollection.getValue();
  if (LCOll == L8){
      collection = "L8";
  }
  else if(LCOll == L9){
      collection = "L9";
  }
};

// 添加滑块控件。
var cloudSlider = ui.Slider({min:0,max:100, style:{width:'200px'}}).setValue(5);

var GenerateImagesButton = ui.Button('Generate Landsat 8/9 and Sentinel-2 Image Collections', generateImsButton);

var appUseText1 = ui.Label('A brief description of how to work with the application can found at the',
  {fontWeight: 'italic', fontSize: '14px', margin:'5px 0px 0px 8px'});
var appUseLink1 = ui.Label(' GitHub repository ',
  {fontWeight: 'italic', fontSize: '14px', margin:'0px 0px 0px 3px',color:'blue'})
  .setUrl('https://github.com/palubad/LST-downscaling-to-10m-GEE#how-to-use-the-lst-downscaling-gee-application');
var appUseText3 = ui.Label(' or in the ',
  {fontWeight: 'italic', fontSize: '14px', margin:'0px 0px 0px 3px'});
var appUseLink2 = ui.Label(' article',
  {fontWeight: 'italic', fontSize: '14px', margin:'0px 0px 0px 3px',color:'blue'})
  .setUrl('https://www.mdpi.com/2072-4292/14/16/4076/htm');
var appUseText4 = ui.Label('.',
  {fontWeight: 'italic', fontSize: '14px', margin:'0px 0px 0px 0px'});

var appUseText5 = ui.Label('To download the downscaled LST images use the ',
  {fontWeight: 'italic', fontSize: '14px', margin:'5px 0px 0px 8px'});
var appUseLink5 = ui.Label(' GEE Code Editor version',
  {fontWeight: 'italic', fontSize: '14px', margin:'5px 0px 0px 3px',color:'blue'})
  .setUrl('https://code.earthengine.google.com/005680c8acf54715c9b10e946400d842');
var appUseText6 = ui.Label('.',
  {fontWeight: 'italic', fontSize: '14px', margin:'5px 0px 0px 0px'});

panel.add(appUseText1)
  .add((ui.Panel([appUseLink1, appUseText3, appUseLink2, appUseText4],ui.Panel.Layout.flow('horizontal'),{margin:'0 0 10px 0px'})))
  .add((ui.Panel([appUseText5, appUseLink5, appUseText6],ui.Panel.Layout.flow('horizontal'),{margin:'0 0 10px 0px'})))
  .add(dateLabel)
  .add((ui.Panel([startLabel, endLabel],ui.Panel.Layout.flow('horizontal'))))
  .add((ui.Panel([startDate_selected, endDate_selected],ui.Panel.Layout.flow('horizontal'))))
  .add(Landsat_collection_label)
  .add(selectCollection)
  .add(cloudSliderLabel)
  .add(cloudSlider)
  .add(GenerateImagesButton);

// 定义输入参数。
var startDate = startDate_selected.getValue(),
    endDate = endDate_selected.getValue(),
    collection = selectCollection.getValue(), // 选择 "L8" 或 "L9"。
    // selected_geometry = map.drawingTools().layers().get(0).toGeometry(),
    cloud_cover = ee.Number(cloudSlider.getValue());

var ROI = /* color: #98ff00 */ee.Geometry.Polygon(
        [[[21.134189623651263, 48.82947658234015],
          [21.134189623651263, 48.57888560664585],
          [21.433567065057513, 48.57888560664585],
          [21.433567065057513, 48.82947658234015]]], null, false);

map.centerObject(ROI,12);
map.drawingTools().addLayer([ROI], 'ROI', 'green')

// 创建用于放置下一部分内容的面板。
var panel2 = ui.Panel();
panel2.style().set({
  width: '500px',
  position: 'bottom-right'
});
panel.add(panel2);

function generateImsButton () {
  panel2.clear();
var selected_geometry = map.drawingTools().layers().get(0).toGeometry();
// var selected_geometry = ROI;

  // 设置影像集合筛选条件。
if (selectCollection.getValue() == "Landsat 8 Image Collection") {
  var collection_id = "LANDSAT/LC08/C02/T1_L2";
} 
if (selectCollection.getValue() == "Landsat 9 Image Collection") {
  var collection_id = "LANDSAT/LC09/C02/T1_L2";
} 
// 选择 Landsat 8 地表反射率数据覆盖范围。
var Landsat_collection = ee.ImageCollection(collection_id)      // 选择影像集合。
                    .filterBounds(selected_geometry)                         // 按研究区筛选影像集合。
                    .filterDate(startDate_selected.getValue(), endDate_selected.getValue())            // 按日期区间筛选影像集合。
                    .filterMetadata("CLOUD_COVER", "less_than", ee.Number(cloudSlider.getValue()));   // 按云量百分比筛选影像集合。
print(Landsat_collection, "- available Landsat images","that meet the input criteria"); /* 打印满足输入条件的 Landsat_collection 可用要素（数据集）；
                                        结果可在 Console 窗口中查看。 */

// 选择 Sentinel-2 Level-2A 影像集合数据覆盖范围。
var S2_collection = ee.ImageCollection("COPERNICUS/S2_SR")
                .filterBounds(selected_geometry)
                .filterDate(startDate_selected.getValue(), endDate_selected.getValue())
                .filterMetadata("CLOUDY_PIXEL_PERCENTAGE", "less_than", ee.Number(cloudSlider.getValue()));
print(S2_collection, "- available Sentinel-2 images","that meet the input criteria");

var landsatList = Landsat_collection.toList(Landsat_collection.size())
var landsatImagesText = "";

if ((Landsat_collection.size().getInfo() > 0) && (S2_collection.size().getInfo()>0)) {
    for (var i=0; i<Landsat_collection.size().getInfo();i++) {
      landsatImagesText = ee.String(landsatImagesText).cat(ee.Image(landsatList.get(i)).id()).cat('; ')
    }
    
    var available_imagesLabel = ui.Label({
        value:'Available Landsat image IDs:',
        style: {margin: '0 0 0 10px',fontSize: '14px'}
      })
    var available_images = ui.Label({
        value: landsatImagesText.getInfo(),
        style: {margin: '0 0 0 10px',fontSize: '11px',color: 'gray'}
      })
    
    var S2List = S2_collection.toList(S2_collection.size())
    var S2ImagesText = "";
    
    for (var i=0; i<S2_collection.size().getInfo();i++) {
      S2ImagesText = ee.String(S2ImagesText).cat(ee.Image(S2List.get(i)).id()).cat('; ')
    }
    
    var available_imagesLabel_S2 = ui.Label({
        value:'Available Sentinel-2 image IDs:',
        style: {margin: '5px 0 0 10px',fontSize: '14px'}
      })
    var available_images_S2 = ui.Label({
        value: S2ImagesText.getInfo(),
        style: {margin: '0 0 0 10px',fontSize: '11px',color: 'gray'}
      })
    
    panel2.add(available_imagesLabel)
          .add(available_images)
          .add(available_imagesLabel_S2)
          .add(available_images_S2)
  
  var IDLabels = ui.Label({
      value:'Enter the selected image IDs',
      style: {fontWeight: 'bold', fontSize: '14px', margin: '10px 0 0 10px'}
    })
    
  var LandsatLabel = ui.Label({
      value:'Enter the selected Landsat ID',
      style: {margin: '5px 0 0 10px',fontSize: '12px',color: 'gray'}
    })
    
  var S2Label = ui.Label({
      value:'Enter the selected Sentinel-2 ID',
      style: {margin: '5px 0 0 10px',fontSize: '12px',color: 'gray'}
    })
  
  var LandsatID = ui.Textbox({placeholder: 'Start Date',  value: 'LC08_186026_20180823',
    style: {width: '350px'}});
  
  var S2ID = ui.Textbox({placeholder: 'End Date',  value: '20180823T094029_20180823T094320_T34UEU',
    style: {width: '350px'}});
  
  panel2.add(IDLabels)
    .add(LandsatLabel)
    .add(LandsatID)
    .add(S2Label)
    .add(S2ID)


  var otherPartsButton = ui.Button('Generate Downscaled LST', GenerateOtherParts);
  
  panel2.add(otherPartsButton);
  
  // 创建用于放置下一部分内容的面板。
  var panel3 = ui.Panel();
  panel3.style().set({
    width: '500px',
    position: 'bottom-right'
  });
  panel2.add(panel3);
  

  function GenerateOtherParts () {
    // 重置地图。
    panel3.clear();
    map.layers().reset();
    
    map.drawingTools().layers().get(0).setShown(false)
    var selected_geometry = map.drawingTools().layers().get(0).toGeometry();
  // var selected_geometry = ROI;
  
    var sentinel_dataset_ID = ee.String('COPERNICUS/S2_SR/');
    
    // 第一次运行后填写影像 ID。
    var S2_selected_dataset = ee.Image(ee.String(ee.String(sentinel_dataset_ID).cat(ee.String(S2ID.getValue()))).getInfo()), // 从打印出的 S2_collection 中选择一个要素（数据集）。
        Landsat_selected_dataset = ee.Image(ee.String(ee.String(collection_id).cat('/').cat(ee.String(LandsatID.getValue()))).getInfo()); // 从打印出的 Landsat_collection 中选择一个要素（数据集）。
    
    var S2_date = S2_selected_dataset.get('system:time_start');
    var S2_StartDate = ee.Date(S2_date).format('YYYY-MM-dd');
    var S2_EndDate = ee.Date(ee.Number.parse(S2_date).add(86400000)).format('YYYY-MM-dd');
    
    var L_date = Landsat_selected_dataset.get('system:time_start');
    var L_StartDate = ee.Date(L_date).format('YYYY-MM-dd');
    var L_EndDate = ee.Date(ee.Number.parse(L_date).add(86400000)).format('YYYY-MM-dd');
    
    // 选择 Landsat 8 地表反射率数据覆盖范围。
    var selected_Landsat_collection = ee.ImageCollection(collection_id)      // 选择影像集合。
                        .filterBounds(selected_geometry)                         // 按研究区筛选影像集合。
                        .filterDate(L_StartDate, L_EndDate)            // 按日期区间筛选影像集合。
                        .filterMetadata("CLOUD_COVER", "less_than", ee.Number(cloudSlider.getValue()))   // 按云量百分比筛选影像集合。
                        .first();
    
    Landsat_selected_dataset = selected_Landsat_collection
    
    // 选择 Sentinel-2 Level-2A 影像集合数据覆盖范围。
    var selected_S2_collection = ee.ImageCollection("COPERNICUS/S2_SR")
                    .filterBounds(selected_geometry)
                    .filterDate(S2_StartDate, S2_EndDate)
                    .filterMetadata("CLOUDY_PIXEL_PERCENTAGE", "less_than", ee.Number(cloudSlider.getValue()))
                    .median();
    
    // 对 Landsat 8/9 Collection 2 影像应用缩放系数。
    function applyScaleFactors(image) {
      var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2).multiply(10000);
      var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0).subtract(273.15);
      return image.addBands(opticalBands, null, true)
                  .addBands(thermalBands, null, true);
    }
  
  // Landsat_collection = Landsat_collection.map(applyScaleFactors);
  Landsat_selected_dataset = applyScaleFactors(Landsat_selected_dataset);
  
  // RGB 和彩色红外（CIR）合成的可视化参数。
  var vizParams2 = {bands: ['SR_B4', 'SR_B3', 'SR_B2'],
                    min: 0,
                    max: 3000,
                    gamma: 1.4,};
  
  // var vizParams3 = {bands: ['SR_B5', 'SR_B4', 'SR_B3'],
  //                   min: 0,
  //                   max: 3000,
  //                   gamma: 1.4,};
  
  // ####################################################################################################################
  
  // 将 Landsat 8 地表反射率影像显示为自然彩色影像（30 m 空间分辨率）。
  
  var L8_image = Landsat_selected_dataset.clip(selected_geometry);
  print(L8_image, 'Landsat-8 clipped Landsat_selected_dataset');
  
  // Map.addLayer(L8_image, vizParams2, "L8_image 30m", 0);
  
  // 选择并显示 Landsat 8 地表反射率彩色红外影像（30 m 空间分辨率）。
  // var image2 = ee.Image("LANDSAT/LC08/C01/T1_SR/LC08_186026_20180823").clip(selected_geometry);
  
  // Map.addLayer(image2, vizParams3, "L8 CIR 30m", 0);
  
  // ####################################################################################################################
  
  // 计算 Landsat 8 光谱指数 NDVI、NDWI 和 NDBI。
  
  // Landsat 8 NDVI（30 m 空间分辨率）。
  var ndvi = Landsat_selected_dataset.normalizedDifference(['SR_B5', 'SR_B4']).rename('ndvi');
  var ndviParams = {min: -1, max: 1, palette: ['purple', 'pink', 'green']};
  var ndviclipped = ndvi.clip(selected_geometry);
  // print(ndviclipped,'ndvi');
  // Map.addLayer(ndviclipped, ndviParams, 'L8_ndvi', 0);
  
  
  // Landsat 8 NDWI（30 m 空间分辨率）。
  var ndwi = Landsat_selected_dataset.normalizedDifference(['SR_B3', 'SR_B5']).rename('ndwi');
  var ndwiParams = {min: -1, max: 1, palette: ['green', 'yellow', 'red', 'blue', 'navy']};
  var ndwiclipped = ndwi.clip(selected_geometry);
  //print(ndwiclipped,'ndwi');
  //Map.addLayer(ndwiclipped, ndwiParams, 'L8_ndwi');
  
  // Landsat 8 NDBI（30 m 空间分辨率）。
  var ndbi = Landsat_selected_dataset.normalizedDifference(['SR_B6', 'SR_B5']).rename('ndbi');
  var ndbiParams = {min: -1, max: 1, palette: ['blue', 'yellow', 'red']};
  var ndbiclipped = ndbi.clip(selected_geometry);
  //print(ndbiclipped,'ndbi');
  //Map.addLayer(ndbiclipped, ndbiParams, 'L8_ndbi');
  
  
  // ####################################################################################################################
  
  // 计算 Landsat 8 摄氏度 LST（30 m 空间分辨率）。
  var L8_LST_30m = L8_image.select('ST_B10').rename('L8_LST_30m');
  
  // 计算 L8_LST_30m 的最小值和最大值。
  var min = ee.Number(L8_LST_30m.reduceRegion({
            reducer: ee.Reducer.min(),
            scale: 30,
            maxPixels: 1e9
            }).values().get(0));
  
  var max = ee.Number(L8_LST_30m.reduceRegion({
            reducer: ee.Reducer.max(),
            scale: 30,
            maxPixels: 1e9
            }).values().get(0));
  
  print("Landsat 8 LST range (°C)", 
        "- 30m spatial resolution:", "", min, 'min L8 LST (30m)', "", max, 'max L8 LST (30m)');
  
  // Map.addLayer(L8_LST_30m, {min: 21.157310795087767, max:41.58105080520278, // 设置 LST 最小值和最大值。
  //             palette: ['040274', '040281', '0502a3', '0502b8', '0502ce', '0502e6',
  //                       '0602ff', '235cb1', '307ef3', '269db1', '30c8e2', '32d3ef',
  //                       //'3be285', '3ff38f', '86e26f', '3ae237', 'b5e22e', 
  //                       'd6e21f', 'fff705', 'ffd611', 'ffb613', 'ff8b13', 'ff6e08', 'ff500d',
  //                       'ff0000', 'de0101', 'c21301', 'a71001', '911003']},'L8-LST 30m');
   
   Export.image.toDrive({
    image: L8_LST_30m,
    description: 'L8_LST_30m',
    folder: "image EE",
    scale: 30,
    region: selected_geometry,
    fileFormat: 'GeoTIFF',
    formatOptions: {
      cloudOptimized: true
    }
  });
  
  // ####################################################################################################################
  
  var medianpixels = selected_S2_collection
  var S2_image = medianpixels.clip(selected_geometry).divide(10000)   
  
  // ####################################################################################################################
  
  // // 选择并显示 Sentinel 2 自然彩色影像（10 m 空间分辨率）。
  // Map.addLayer(S2_image, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.23}, 'S2 RGB 10m', 0);
  
  // // 选择并显示 Sentinel 2 彩色红外影像（10 m 空间分辨率）。
  // Map.addLayer(S2_image, {bands: ['B8', 'B4', 'B3'], min: 0, max: 0.23}, 'S2 CIR 10m', 0);
  
  // ####################################################################################################################
  
  // 计算 Sentinel 2 光谱指数 NDVI、NDWI 和 NDBI。
  
  // Sentinel 2 NDVI（10 m 空间分辨率）。
  var S2_ndvi = S2_image.normalizedDifference(['B8', 'B4']).rename('S2_NDVI');
  var S2_ndviParams4 = {min: -1, max: 1, palette: ['purple', 'pink', 'green']};
  var S2_ndviclipped = S2_ndvi.clip(selected_geometry);
  //print(S2_ndviclipped,'S2_ndvi');
  //Map.addLayer(S2_ndviclipped, S2_ndviParams4, 'S2_ndvi');
  
  // Sentinel 2 NDWI（10 m 空间分辨率）。
  var S2_ndwi = S2_image.normalizedDifference(['B3', 'B11']).rename('S2_NDWI');
  var S2_ndwiParams4 = {min: -1, max: 1, palette: ['green', 'yellow', 'red', 'blue', 'navy']};
  var S2_ndwiclipped = S2_ndwi.clip(selected_geometry);
  //print(S2_ndwiclipped,'S2_ndwi');
  //Map.addLayer(S2_ndwiclipped, S2_ndwiParams4, 'S2_ndwi');
  
  // Sentinel 2 NDBI（10 m 空间分辨率）。
  var S2_ndbi = S2_image.normalizedDifference(['B11', 'B8']).rename('S2_NDBI');
  var S2_ndbiParams4 = {min: -1, max: 1, palette: ['blue', 'yellow', 'purple']};
  var S2_ndbiclipped = S2_ndbi.clip(selected_geometry);
  //print(S2_ndbiclipped,'S2_ndbi');
  //Map.addLayer(S2_ndbiclipped, S2_ndbiParams4, 'S2_ndbi');
  
  
  // ####################################################################################################################
  // 为线性回归创建图表数据。
  
  var imgForChart = L8_LST_30m.addBands([ndvi,ndwi,ndbi])
  var randomPoints = ee.FeatureCollection.randomPoints(selected_geometry, 500, 40);

  // 将影像波段值添加到随机点中。
  var pointsWithValue = imgForChart.reduceRegions({
      collection: randomPoints,
      reducer: ee.Reducer.mean(),
      scale: 30,
  });
  
  var getValues = ee.FeatureCollection(pointsWithValue.filter(ee.Filter.notNull(['L8_LST_30m', 'ndvi', 'ndwi', 'ndbi'])));

  
  // 创建数组，用于存放所选点的 LST、NDVI、NDWI 和 NDBI 值。
  var LST_points = getValues.aggregate_array('L8_LST_30m');
  var NDVI_points = getValues.aggregate_array('ndvi');
  var NDWI_points = getValues.aggregate_array('ndwi');
  var NDBI_points = getValues.aggregate_array('ndbi');
  
    


  // ##########################################################################
  // 回归计算。
  
  // 准备用于回归的波段。
  var bands = ee.Image(1).addBands(ndvi).addBands(ndbi).addBands(ndwi).addBands(L8_LST_30m).rename(["constant", "ndvi", "ndbi", "ndwi", "L8"]);
  
  // 运行多元线性回归分析。
  var imageRegression = bands.reduceRegion({
                        reducer: ee.Reducer.linearRegression({numX:4, numY:1}),
                        geometry: selected_geometry,
                        scale: 30,
                        });
  
  // 根据回归系数创建影像。
  print ("", "* Multipe linear regression model" ,"coefficients for Landsat 8 LST downscaling")
  var coefList2 = ee.Array(imageRegression.get("coefficients")).toList();
  var intercept2 = ee.Image(ee.Number(ee.List(coefList2.get(0)).get(0)));
  var intercept2_list = ee.List(coefList2.get(0)).get(0);
  var slopeNDVI2 = ee.Image(ee.Number(ee.List(coefList2.get(1)).get(0)));
  var slopeNDVI2_list =  ee.List(coefList2.get(1)).get(0);
  var slopeNDBI2 = ee.Image(ee.Number(ee.List(coefList2.get(2)).get(0)));
  var slopeNDBI2_list =  ee.List(coefList2.get(2)).get(0);
  var slopeNDWI2 = ee.Image(ee.Number(ee.List(coefList2.get(3)).get(0)));
  var slopeNDWI2_list =  ee.List(coefList2.get(3)).get(0);
  
  print(intercept2_list, "intercept", "",
        slopeNDVI2_list, "slope NDVI", "", 
        slopeNDBI2_list, "slope NDBI", "",
        slopeNDWI2_list, "slope NDWI");
  
  // 计算最终的降尺度影像。
  var downscaled_LST_10m = ee.Image(intercept2).add(slopeNDVI2.multiply(S2_ndvi))
              .add(slopeNDBI2.multiply(S2_ndbi)).add(slopeNDWI2.multiply(S2_ndwi));
  
  // 添加到地图。
  //Map.addLayer(downscaled_LST_10m, lstParams2, 'S2-LST 10m');
  
  // #######################################################################
  // 计算 30 m Landsat 8/9 LST 模型值。
  
  var L8_LST_MODEL = intercept2.add(slopeNDVI2.multiply(ndvi))
              .add(slopeNDBI2.multiply(ndbi))
              .add(slopeNDWI2.multiply(ndwi)).clip(selected_geometry);
  
  var L8_RESIDUALS = L8_LST_30m.subtract(L8_LST_MODEL);
  
  var palette = ['040274', '040281', '0502a3', '0502b8', '0502ce', '0502e6',
                        '0602ff', '235cb1', '307ef3', '269db1', '30c8e2', '32d3ef',
                        //'3be285', '3ff38f', '86e26f', '3ae237', 'b5e22e', 
                        'd6e21f', 'fff705', 'ffd611', 'ffb613', 'ff8b13', 'ff6e08', 'ff500d',
                        'ff0000', 'de0101', 'c21301', 'a71001', '911003'];
  
  // Map.addLayer(L8_LST_MODEL, {min: 21.157310795087767, max:41.58105080520278, // 设置 LST 最小值和最大值。
  //             palette: palette}, 'L8_LST_MODEL');
  
  
  // ####################################################################### 
  // 高斯卷积。
  
  // 定义高斯核。
  var gaussian = ee.Kernel.gaussian({
    radius: 1.5, units: 'pixels'
  });
  
  // 通过高斯核卷积对影像进行平滑。
  var L8_RESIDUALS_gaussian = L8_RESIDUALS.resample("bicubic").convolve(gaussian);
  
  var visParam_residuals = {
          min: -10,
          max: 9,
          palette: ['blue', 'yellow', 'red']
          };
  
  // Map.addLayer(L8_RESIDUALS, visParam_residuals, "L8_RESIDUALS_original",false);
  // Map.addLayer(L8_RESIDUALS_gaussian, visParam_residuals, "L8_RESIDUALS_gaussian",false);
  
  // 
  // 计算最终降尺度后的 LST。
  var downscaled_LST_10m2 = ee.Image(intercept2).add(slopeNDVI2.multiply(S2_ndvi))
                .add(slopeNDBI2.multiply(S2_ndbi)).add(slopeNDWI2.multiply(S2_ndwi));
  
  // Map.addLayer(downscaled_LST_10m2, lstParams2, 'S2-LST 10m (no residuals)');
  
  var S2_LST_10_w_Residuals = downscaled_LST_10m2.add(L8_RESIDUALS_gaussian)

  var min_legend = ee.Number(S2_LST_10_w_Residuals.reduceRegion({
          reducer: ee.Reducer.min(),
          scale: 10,
          maxPixels: 1e12,
          crs: 'EPSG:4326'
          }).values().get(0));

  var max_legend = ee.Number(S2_LST_10_w_Residuals.reduceRegion({
            reducer: ee.Reducer.max(),
            scale: 10,
            maxPixels: 1e12,
            crs: 'EPSG:4326'
            }).values().get(0));
  
  
  var lstParams2 = {min: min_legend.getInfo(), max:max_legend.getInfo(), 
                  palette: ['040274', '040281', '0502a3', '0502b8', '0502ce', '0502e6',
                            '0602ff', '307ef3', '30c8e2', '32d3ef',
                            'fff705', 'ffd611', 'ffb613', 'ff8b13', 'ff6e08', 'ff500d',
                            'ff0000', 'de0101', 'c21301', 'a71001', '911003']};

  // 将最终影像导出到 Google Drive。
  Export.image.toDrive({
    image: S2_LST_10_w_Residuals,
    description: 'Downscaled_LST_usingS2_10m',
    folder: "image EE",
    scale: 10,
    region: selected_geometry,
    crs: 'EPSG:4326',
    maxPixels: 1e12,
    fileFormat: 'GeoTIFF',
    formatOptions: {
      cloudOptimized: true
    }
  });
  
  
  
  // ##################################################################### //
  // ######################## 用户界面准备 ############################### //
  // ##################################################################### //
  
  // 用户界面设计参考了 Abigail Barenblitt 和 Temilola Fatoyinbo 的演示与代码：
  // https://appliedsciences.nasa.gov/sites/default/files/2020-10/Part3App_Final.pdf
  // https://code.earthengine.google.com/705e6c7974f42373f1b9535e2bd40243
  
  // 设置地图外观和应用图层。
  // 将地图中心定位到 selected_geometry。
  Map.centerObject(selected_geometry,12); 
  
  // 为每个 GUI 图层创建变量。
  var L8_image_viz = ui.Map.Layer(L8_image, vizParams2, "Landsat 8/9 RGB",false);
  var S2_image_viz = ui.Map.Layer(S2_image, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.23}, 'Sentinel-2 RGB',false);
  var L8_LST_viz = ui.Map.Layer(L8_LST_30m, lstParams2,'L8-LST 30m', false);
  var residuals_layer = ui.Map.Layer(L8_RESIDUALS_gaussian, visParam_residuals, "Landsat 8/9 LST regression residuals",false);
  var L8_LST_10_noResiduals = ui.Map.Layer(downscaled_LST_10m2, lstParams2, 'S2-LST 10m (no residuals)', false);
  var L8_LST_10_with_Residuals = ui.Map.Layer(S2_LST_10_w_Residuals, lstParams2, "S2-LST 10m with residuals", true);
  

  // 将图层添加到地图。
  map.add(L8_image_viz);
  map.add(S2_image_viz);
  map.add(residuals_layer);
  map.add(L8_LST_viz);
  map.add(L8_LST_10_noResiduals);
  map.add(L8_LST_10_with_Residuals);
  
  ///////////////////////////////////////////////////////////////
  //                添加复选框控件和图例                       //
  ///////////////////////////////////////////////////////////////
  
  var selectLayerLabel = ui.Label({
      value:'Select layers to display.',
      style: {fontWeight: 'bold', fontSize: '16px', margin: '10px 0 0 10px'}
    });
  
  // 将复选框添加到界面。
  var additionalCheck = ui.Checkbox('Landsat 8/9 RGB').setValue(false); 
  var additionalCheck2 = ui.Checkbox('Sentinel-2 RGB').setValue(false);
  var additionalCheck3 = ui.Checkbox('Landsat 8/9 LST').setValue(false);
  var additionalCheck4 = ui.Checkbox('Landsat 8/9 LST regression residuals').setValue(false); 
  var additionalCheck5 = ui.Checkbox('LST 10 m (no residuals)').setValue(false); 
  var additionalCheck6 = ui.Checkbox('LST 10 m with residuals').setValue(true); 
  var additionalCheck7 = ui.Checkbox('ROI').setValue(false); 

  // 创建图例。
  // 设置图例面板位置。
  var legend = ui.Panel({
    style: {
      position: 'bottom-left',
      padding: '8px 15px'
    }
  });
  
  // 下面的函数用于创建并设置图例中的一行。
  var makeRowa = function(color, name) {
   
        // 创建实际显示为色块的标签。
        var colorBox = ui.Label({
          style: {
            backgroundColor: '#' + color,
            // 使用 padding 设置色块的高度和宽度。
            padding: '8px',
            margin: '0 0 4px 0'
          }
        });
   
        // 创建包含说明文字的标签。
        var description = ui.Label({
          value: name,
          style: {margin: '0 0 4px 6px'}
        });
   
        // 返回这一行图例面板。
        return ui.Panel({
          widgets: [colorBox, description],
          layout: ui.Panel.Layout.Flow('horizontal')
        });
  };
  
  
  // 图例。
  // 图例标题。
  var legendLabel = ui.Label({value:'Land Surface Temperature (°C)',
  style: {fontWeight: 'bold', fontSize: '16px', margin: '10px 0 0 10px'}
  });
  
  // 该函数根据给定的单波段可视化参数构建图例。
  // 要求可视化参数包含 'min' 和 'max'，但不包含 'bands'。
  function makeLegend (params) {
    var lon = ee.Image.pixelLonLat().select('longitude');
    var gradient = lon.multiply((params.max-params.min)/100.0).add(params.min);
    var legendImage = gradient.visualize(params);
    
    var thumb = ui.Thumbnail({
      image: legendImage, 
      params: {bbox:'0,0,100,8', dimensions:'256x20'},  
      style: {position: 'bottom-center'}
    });
    
    
    var panel4 = ui.Panel({
      widgets: [
        ui.Label(ee.Number(min_legend).round().getInfo()), 
        ui.Label({style: {stretch: 'horizontal'}}), 
        ui.Label(ee.Number(max_legend).round().getInfo())
      ],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {stretch: 'horizontal', maxWidth: '270px', padding: '0px 0px 0px 0px',
      margin: '0 0 0 0'}
    });
    return ui.Panel().add(panel4).add(thumb);
  }
  
  var ChartButton = ui.Button('Generate charts of spectral indices vs Landsat 8/9 LST', GenerateCharts);
  
  
  // 按顺序将控件添加到面板。
  panel3.add(selectLayerLabel)
        .add(additionalCheck6)
        .add(additionalCheck5)
        .add(additionalCheck3)
        .add(additionalCheck4)
        .add(additionalCheck2)
        .add(additionalCheck)
        .add(additionalCheck7)
        .add(legendLabel)
        .add(makeLegend(lstParams2))
        .add(ChartButton)
  
    // 创建用于放置下一部分内容的面板。
  var panel5 = ui.Panel();
  panel5.style().set({
    width: '500px',
    position: 'bottom-right'
  });
  panel3.add(panel5);
  
  
  function GenerateCharts() {
    panel5.clear();
    var chartNDVI = ui.Chart.array.values(LST_points, 0, NDVI_points)
    .setOptions({
      title: 'Correlation LST - NDVI  based on Landsat 8/9 image',
      legend: true,
      hAxis: {title: 'NDVI'},
      vAxis: {title: 'LST (°C)'},
      series: {
          0: {pointSize: 1, color: 'blue',visibleInLegend: false}, // 观测点。
        },
      trendlines: {
          0: {
              type: 'linear',
              color: 'CC0000',
              showR2: true,
              visibleInLegend: true
          }
      }
    });
    
    var chartNDWI = ui.Chart.array.values(LST_points, 0, NDWI_points)
    .setOptions({
      title: 'Correlation LST - NDWI  based on Landsat 8/9 image',
      legend: true,
      hAxis: {title: 'NDWI'},
      vAxis: {title: 'LST (°C)'},
      series: {
          0: {pointSize: 1, color: 'blue',visibleInLegend: false}, // 观测点。
        },
      trendlines: {
          0: {
              type: 'linear',
              color: 'CC0000',
              showR2: true,
              visibleInLegend: true
          }
      }
    });
    
      var chartNDBI = ui.Chart.array.values(LST_points, 0, NDBI_points)
    .setOptions({
      title: 'Correlation LST - NDBI  based on Landsat 8/9 image',
      legend: true,
      hAxis: {title: 'NDBI'},
      vAxis: {title: 'LST (°C)'},
      series: {
          0: {pointSize: 1, color: 'blue',visibleInLegend: false}, // 观测点。
        },
      trendlines: {
          0: {
              type: 'linear',
              color: 'CC0000',
              showR2: true,
              visibleInLegend: true
          }
      }
    });
    panel5.add(chartNDVI)
        .add(chartNDWI)
        .add(chartNDBI)
  } 
  
  ///////////////////////////////////////////////////////////////
  //                为控件添加交互功能                         //
  ///////////////////////////////////////////////////////////////
  
  // 为每个复选框创建函数；
  // 点击复选框即可打开或关闭相应图层。
  
  // Landsat 8/9 RGB 图层。
  var doCheckbox = function() {
    
    additionalCheck.onChange(function(checked){
    L8_image_viz.setShown(checked)
    })
  }
  doCheckbox();
  
  // Sentinel-2 RGB 图层。
  var doCheckbox2 = function() {
    
    additionalCheck2.onChange(function(checked){
    S2_image_viz.setShown(checked)
    })
    
  
  }
  doCheckbox2();
  
  // Landsat 8/9 LST 图层。
  var doCheckbox3 = function() {
    
    additionalCheck3.onChange(function(checked){
    L8_LST_viz.setShown(checked)
    })
    
  
  }
  doCheckbox3();
  
  // 残差图层。
  var doCheckbox4 = function() {
    
    additionalCheck4.onChange(function(checked){
    residuals_layer.setShown(checked)
    })
  }
  doCheckbox4();
  
  // 不含残差的 10 m LST 图层。
  var doCheckbox5 = function() {
    
    additionalCheck5.onChange(function(checked){
    L8_LST_10_noResiduals.setShown(checked)
    })
    
  
  }
  doCheckbox5();
  
  // 含残差的最终降尺度影像图层。
  var doCheckbox6 = function() {
    
    additionalCheck6.onChange(function(checked){
    L8_LST_10_with_Residuals.setShown(checked)
    })
    
  
  }
  doCheckbox6();
  
  var doCheckbox7 = function() {
  
  additionalCheck7.onChange(function(checked){
  map.drawingTools().layers().get(0).setShown(checked)
  })
  

  }
  doCheckbox7();
    
  }
  
}
  else {
    var Error_message = ui.Label({
      value:'There are 0 images either in Sentinel-2 or Landsat 8/9 Image Collections. Please try to change some parameters and generate images again.',
      style: {margin: '0 0 0 10px',fontSize: '14px', color: 'red'}
    })
    panel2.add(Error_message)
  }
  }
