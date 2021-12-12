var cityTiles=[];
var roadChoiceWeights=[0.7,0.1,0.1,0.025,0.025,0.025,0.025];
var largeBuildingChance=0.1;
var smallBuildingChance=0.6;

var renderingShader=null;
var canvas=null;
var currentScreen=null;
var repeatX;
var repeatY;
var renderSquareSize=0.1;
var rrX=-0.1;
var rrY=0.0;

var currentObjectIndex=0;
var lightD;
var objectTypes;
var objectPositions;
var objectRotations;
var objectSizes;
var objectColours;
var objectMaterials;


//Chooses a random item from a list given weights for all of them. Based on the "Linear Scan"
//example from https://blog.bruce-hill.com/a-faster-weighted-random-choice
function weightedChoose(weights,items)
{
  var weightSum=0.0;
  for(let i of weights)
  {
    weightSum+=i;
  }
  
  var remainingSum=random()*weightSum; //remainingSum is placed a random distance along a line containing the fractions of each weight.
  for(let i=0;i<weights.length;i++)
  {
    remainingSum-=weights[i]; //The current weight is removed from the remaining sum.
    if(remainingSum<=0.0)
    {
      return items[i]; //The original remainingSum value has been reached and the the item associated with the weight that contained the original remainingSum value is returned.
    }
  }
}


class CityTile
{
  constructor()
  {
    this.neighbours=[null,null,null,null]; //Holds referecnes to the tiles connected up,right,down and left to this tile.
    this.roadConnections=[false,false,false,false]; //Holds which neighbours are connected to this one if this tile is a road piece.
    this.tileType=-1; //A negative value means that the tile has not been assigned a type yet.
    this.position=null;
  }
  
  //Joins two tiles together as roads.
  joinRoadTile(otherTile)
  {
    for(let i=0;i<4;i++)
    {
      if(this.neighbours[i]===otherTile)
      {
        if(this.roadConnections[i]==false) //If the other tile has not been connected to this one on this side yet.
        {
          this.roadConnections[i]=true;
          otherTile.joinRoadTile(this); //A connection is attempted on the other side.
        }

        break;
      }
    }
  }
  
  //Determines is a small building can be placed on this tile. This is if at least one of the four neighbouring tiles is a road tile and if this tile is currently free.
  canPlaceSmallBuilding()
  {
    if(this.tileType!=-1) //If the current tile already has a type.
    {
      return false;
    }
    
    for(let i of this.neighbours)
    {
      if((i.tileType!=-1)&&(i.roadConnections!="false,false,false,false")) //If this neighbouring tile is a road tile.
      {
        return true;
      }
    }
    
    return false;
  }
  
  //Determines if a large building (2x2 tiles) can be placed with the lower-left corner as this tile. This will occur if at least one tile surrounding the four tiles of the building will be a road tile and all of the four tiles
  //the building will be made from are free.
  canPlaceLargeBuilding()
  {
    var squaresAreFree=(this.tileType==-1)&&(this.neighbours[0].tileType==-1)&&(this.neighbours[1].tileType==-1)&&(this.neighbours[0].neighbours[1].tileType==-1);
    var atLeastOneRoadSurrounds=(this.canPlaceSmallBuilding())||(this.neighbours[0].canPlaceSmallBuilding())||(this.neighbours[1].canPlaceSmallBuilding())||(this.neighbours[0].neighbours[1].canPlaceSmallBuilding());
    return squaresAreFree&&atLeastOneRoadSurrounds;
  }
}


//This is an object that turns city tiles into road tiles by growing roads piece by piece.
class RoadBuilder
{
  constructor(startingTile,startingDirection)
  {
    this.currentTile=startingTile;
    this.currentDirection=startingDirection;
  }
  
  //Randomly chooses new road pieces and lays them. Creates new RoadBuilder objects if an intersection is built.
  layRoad(newBuilders,removedBuilders,totalRoadPieces)
  {
    totalRoadPieces.value+=1; //The total number of road pieces built is incremented.
    
    //Various directions and tiles relative to the current tile and direction of the RoadBuilder.
    var forwardDirection=this.currentDirection;
    var leftDirection=(this.currentDirection==0) ? 3:this.currentDirection-1;
    var rightDirection=(this.currentDirection==3) ? 0:this.currentDirection+1;
    
    var forwardTile=this.currentTile.neighbours[forwardDirection];
    var leftTile=this.currentTile.neighbours[forwardDirection];
    var rightTile=this.currentTile.neighbours[forwardDirection];

    var forwardBuilder=null;
    var leftBuilder=null;
    var rightBuilder=null;
    
    
    switch(weightedChoose(roadChoiceWeights,["straight","left","right","tLeft","tRight","tStraight","cross"])) //A new direction to go in is randomly chosen.
    {
      case "straight":
        forwardTile.joinRoadTile(this.currentTile); //The next tile is connected to the current one.
        this.currentTile=forwardTile; //The RoadBuilder is moved to the next tile.
        break;
      case "left":
        leftTile.joinRoadTile(this.currentTile);
        this.currentTile=leftTile;
        this.currentDirection=leftDirection; //The direction of the RoadBuilder is changed.
        break;
      case "right":
        rightTile.joinRoadTile(this.currentTile);
        this.currentTile=rightTile;
        this.currentDirection=rightDirection;
        break;
      case "tLeft":
        forwardTile.joinRoadTile(this.currentTile);
        leftTile.joinRoadTile(this.currentTile);
        
        forwardBuilder=new RoadBuilder(forwardTile,forwardDirection); //New RoadBuilders are created in order to create new roads off this intersection.
        leftBuilder=new RoadBuilder(leftTile,leftDirection);
        newBuilders.push(forwardBuilder,leftBuilder);
        removedBuilders.push(this); //This builder is removed as it has ended at an intersection.
        break;
      case "tRight":
        forwardTile.joinRoadTile(this.currentTile);
        rightTile.joinRoadTile(this.currentTile);
        
        forwardBuilder=new RoadBuilder(forwardTile,forwardDirection);
        rightBuilder=new RoadBuilder(rightTile,rightDirection);
        newBuilders.push(forwardBuilder,rightBuilder);
        removedBuilders.push(this);
        break;
      case "tStraight":
        leftTile.joinRoadTile(this.currentTile);
        rightTile.joinRoadTile(this.currentTile);
        
        leftBuilder=new RoadBuilder(leftTile,leftDirection);
        rightBuilder=new RoadBuilder(rightTile,rightDirection);
        newBuilders.push(leftBuilder,rightBuilder);
        removedBuilders.push(this);
        break;
      case "cross":
        forwardTile.joinRoadTile(this.currentTile);
        leftTile.joinRoadTile(this.currentTile);
        rightTile.joinRoadTile(this.currentTile);
        
        forwardBuilder=new RoadBuilder(forwardTile,forwardDirection);
        leftBuilder=new RoadBuilder(leftTile,leftDirection);
        rightBuilder=new RoadBuilder(rightTile,rightDirection);
        newBuilders.push(forwardBuilder,leftBuilder,rightBuilder);
        removedBuilders.push(this);
        break;     
    }
  }
}

//Runs RoadBuilders on the array of city tiles until a specified number of roads have been built.
function runRoadBuilders(numberOfRoadsToBuild)
{
  var totalRoadPieces={"value":0};
  var initialRoadBuilder=new RoadBuilder(cityTiles[5][5],0); //The first road builder is placed in the middle of the city tile grid.
  var roadBuilderList=[initialRoadBuilder]; //The list of active RoadBuilders on the city tile grid.
  
  while(totalRoadPieces.value<numberOfRoadsToBuild)
  {
    var newBuilders=[]; //RoadBuilders created from intersections.
    var removedBuilders=[]; //RoadBuilders removed after creating an intersection.
    
    for(let i=0;i<roadBuilderList.length;i++) //Loops through all active RoadBuilders and makes them place a road piece each.
    {
      roadBuilderList[i].layRoad(newBuilders,removedBuilders,totalRoadPieces);  
    }
    
    for(let i=0;i<removedBuilders.length;i++) //Removes all the RoadBuilders fom the active list that were marked for removal in the previous loop.
    {
      roadBuilderList.splice(roadBuilderList.indexOf(removedBuilders[i]),1);
    }
    
    roadBuilderList.push(...newBuilders); //Adds the new RoadBuilders to the active list.    
  }
}


function createTileGrid(sizeX,sizeY)
{
  //The CityTiles are created in a grid.
  var tileGrid=[];
  for(let x=0;x<sizeX;x++)
  {
    var tileGridRow=[];
    for(let y=0;y<sizeY;y++)
    {
      var newCityTile=new CityTile();
      tileGridRow.push(newCityTile);
    }
    tileGrid.push(tileGridRow);
  }
  
  //The neighbours for each tile are assigned.
  for(let x=0;x<sizeX;x++)
  {
    for(let y=0;y<sizeY;y++)
    {
      //Neighbours are wrapped around on the grid edges so that the city block will be able to tile with itself.
      var upIndex=(y==(sizeY-1) ? 0:y+1);
      var downIndex=(y==0 ? sizeY-1:y-1);
      var leftIndex=(x==0 ? sizeX-1:x-1);
      var rightIndex=(x==(sizeX-1) ? 0:x+1);

      var upNeighbour=tileGrid[x][upIndex];
      var downNeighbour=tileGrid[x][downIndex];
      var leftNeighbour=tileGrid[leftIndex][y];
      var rightNeighbour=tileGrid[rightIndex][y];
      
      tileGrid[x][y].neighbours=[upNeighbour,rightNeighbour,downNeighbour,leftNeighbour];
      tileGrid[x][y].position=[(x+0.5)-(sizeX/2.0),(y+0.5)-(sizeY/2.0),0.0];
    }
  }
  
  return tileGrid;
}

//Determines what sort of road piece should be placed on each city tile from its road neighbour connections.
function determineRoadTiles()
{
  for(let ctX of cityTiles)
  {
    for(let ctXY of ctX)
    {
      var isRoadTile=true;
      switch(ctXY.roadConnections.toString())
      {
        case "false,true,false,true": //Horizontal straight.
          addRoadStraight(ctXY.position,0);
          break;
        case "true,false,true,false": //Vertical straight.
          addRoadStraight(ctXY.position,1);
          break;
        case "true,false,false,true": //Left-up turn.
          addRoadCurve(ctXY.position,0);
          break;
        case "true,true,false,false": //Right-up turn.
          addRoadCurve(ctXY.position,3);
          break;
        case "false,false,true,true": //Left-down turn.
          addRoadCurve(ctXY.position,1);
          break;
        case "false,true,true,false": //Right-down turn.
          addRoadCurve(ctXY.position,2);
          break;
        case "true,true,false,true": //Horizontal-up t-intersection.
          addRoadT(ctXY.position,0);
          break;
        case "false,true,true,true": //Horizontal-down t intersection.
          addRoadT(ctXY.position,2);
          break;
        case "true,false,true,true": //Vertical-left t intersection.
          addRoadT(ctXY.position,1);
          break;
        case "true,true,true,false": //Vertical-right t-intersection.
          addRoadT(ctXY.position,3);
          break;
        case "true,true,true,true": //Cross intersection.
          addRoadCross(ctXY.position);
          break; 
        default:
          isRoadTile=false;
      }
           
      ctXY.tileType=isRoadTile? 1:-1;
    }
  }
}

//Attempts to first place large buildings at each free square with a specific probability, and then it attempts to place small buildings on each remaining free
//square at a different probability.
function determineBuildingTiles(largeBuildingChance,smallBuildingChance)
{
  //Large building placement occurs first.
  for(let ctX of cityTiles)
  {
    for(let ctXY of ctX)
    {
      if((ctXY.tileType==-1)&&(ctXY.roadConnections.toString()=="false,false,false,false")) //If the current tile has not been assigned yet and if this tile cannot be a road tile.
      {
        if((ctXY.canPlaceLargeBuilding())&&(random()<largeBuildingChance)) //If a large building can be placed here and the random choice to place a large building here has been successful.
        {
          //A 2x2 area with this tile as the lower left corner is designated as a large building.
          ctXY.tileType=2;
          ctXY.neighbours[0].tileType=2;
          ctXY.neighbours[1].tileType=2;
          ctXY.neighbours[0].neighbours[1].tileType=2;      
          
          buildingX=ctXY.position[0]+0.5;
          buildingY=ctXY.position[1]+0.5;
          addBuilding([buildingX,buildingY,0.0],2.0);
        }
      }
    }
  }
  
  //Small building placement.
  for(let ctX of cityTiles)
  {
    for(let ctXY of ctX)
    {
      if((ctXY.tileType==-1)&&(ctXY.roadConnections.toString()=="false,false,false,false")) //If the current tile has not been assigned yet and if this tile cannot be a road tile.
      {
        if((ctXY.canPlaceSmallBuilding())&&(random()<smallBuildingChance)) 
        {
          ctXY.tileType=3;  
          addBuilding(ctXY.position,1.0);
        }
      }
    }
  }
}



//Converts a floating point number into a sequence of three bytes by converting it to base 256. 2000 is added to the input
//and that is multiplied by 4000 so a large range of floating point values between -2000 and 2000 can be stored.
function floatToColourArray(input)
{
  var remainingInput=(input+2000.0)*4000.0; //The input is shifted and scaled.
  var column3=floor(remainingInput/65536.0); //How many of remainingInput can fit in the 256^2 column.
  remainingInput=remainingInput%65536; //The amount left over that does not fit into the 256^2 column.
  var column2=floor(remainingInput/256.0); 
  remainingInput=remainingInput%256; 
  var column1=floor(remainingInput); 
  return [column1,column2,column3,255];
}

function vec3ToTexture(dataTexture,inputArray,iX)
{
  dataTexture.set(iX,0,floatToColourArray(inputArray[0]));  
  dataTexture.set(iX,1,floatToColourArray(inputArray[1]));
  dataTexture.set(iX,2,floatToColourArray(inputArray[2]));
}


function addObject(type,position,rotation,size,colour,material)
{
  objectTypes.set(currentObjectIndex,0,floatToColourArray(type));
  vec3ToTexture(objectPositions,position,currentObjectIndex);
  vec3ToTexture(objectRotations,rotation,currentObjectIndex);
  vec3ToTexture(objectSizes,size,currentObjectIndex);
  vec3ToTexture(objectColours,colour,currentObjectIndex);
  objectMaterials.set(currentObjectIndex,0,floatToColourArray(material));
  currentObjectIndex+=1;
}


function addRoadStraight(position,direction)
{
  addObject(0,position,[0.0,0.0,HALF_PI*direction],[0.0,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(4,position,[0.0,0.0,HALF_PI*direction],[0.0,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadCurve(position,direction)
{
  addObject(1,position,[0.0,0.0,HALF_PI*direction],[0.0,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(5,position,[0.0,0.0,HALF_PI*direction],[0.0,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadT(position,direction)
{
  addObject(2,position,[0.0,0.0,HALF_PI*direction],[0.0,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(6,position,[0.0,0.0,HALF_PI*direction],[0.0,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadCross(position)
{
  addObject(3,position,[0.0,0.0,0.0],[0.0,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(7,position,[0.0,0.0,0.0],[0.0,0.0,0.0],[0.78,0.78,0.78],0);
}

function addBuilding(position,scale)
{
  var colour=[random(1.0),random(1.0),random(1.0)];
  var rotation=[random(TWO_PI),random(TWO_PI),random(TWO_PI)];
  var buildingType=weightedChoose([1.0,1.0,1.0,1.0,1.0],[9,10,11,12,13]);
  var size=[];
  var material=weightedChoose([0.95,0.05],[0,1]);
  
  switch(buildingType)
  {
    case 9:
      size=[scale*random(0.35,0.45),0.0,0.0];
      break;
    case 10:
      size=[scale*random(0.35,0.45),scale*random(0.35,0.45),scale*random(0.35,0.45)];
      break;
    case 11:
      var r1=random(0.35,0.45);
      var r2=random(0.1,0.9)*r1;
      size=[scale*r1,scale*r2,0.0];
      break;
    case 12:
      var r=random(0.35,0.45);
      var h=random(0.7,0.9);
      size=[scale*r,scale*h,0.0];
      break;
    case 13:
      size=[random(0.35,0.45),0.0,0.0];
      break;
  }

  addObject(buildingType,[position[0],position[1],scale*0.75],rotation,size,colour,material);
}





function preload()
{
  renderingShader=loadShader("vertexShader.glsl","rendering.glsl");
}


function setup() 
{
  canvas=createCanvas(windowWidth,windowHeight,WEBGL);
  pixelDensity(1);
  currentScreen=createImage(width,height);
  //randomSeed(2);
  //randomSeed(64754226562);
  
  objectTypes=createImage(1000,1);
  objectPositions=createImage(1000,3);
  objectRotations=createImage(1000,3);
  objectSizes=createImage(1000,3);
  objectColours=createImage(1000,3);
  objectMaterials=createImage(1000,1);
  
  objectTypes.loadPixels();
  objectPositions.loadPixels();
  objectRotations.loadPixels();
  objectSizes.loadPixels();
  objectColours.loadPixels();
  objectMaterials.loadPixels();
  groundColour=weightedChoose([1.0,1.0],[[0.35,0.78,0.31],[1.0,0.78,0.31]]);
  addObject(8,[0.0,0.0,0.0],[0.0,0.0,0.0],[0.0,0.0,0.0],groundColour,0);

  
  cityTiles=createTileGrid(10,10);
  runRoadBuilders(30);
  determineRoadTiles();
  determineBuildingTiles(largeBuildingChance,smallBuildingChance);
  
  objectTypes.updatePixels();
  objectPositions.updatePixels();
  objectRotations.updatePixels();
  objectSizes.updatePixels();
  objectColours.updatePixels();
  objectMaterials.updatePixels();

  lightD=[random(-1.0,1.0),random(-1.0,1.0),random(0.1,1.0)];
  repeatX=random(1.0)>0.5;
  repeatY=random(1.0)>0.5;
}


function draw() 
{
  currentScreen=canvas.get();

  renderingShader.setUniform("resolution",[width,height]);
  renderingShader.setUniform("renderRegion1",[rrX,rrY]);
  renderingShader.setUniform("renderRegion2",[rrX+renderSquareSize,rrY+renderSquareSize]);
  renderingShader.setUniform("currentScreen",currentScreen);
  renderingShader.setUniform("cameraLocation",[150.0,-150.0,150.0]);
  renderingShader.setUniform("cameraForward",[-1,1,-1]);
  renderingShader.setUniform("lightD",lightD);
  
  renderingShader.setUniform("repeatX",repeatX);
  renderingShader.setUniform("repeatY",repeatY);
  
  renderingShader.setUniform("objectCount",currentObjectIndex);
  renderingShader.setUniform("objectTypes",objectTypes);
  renderingShader.setUniform("objectPositions",objectPositions);
  renderingShader.setUniform("objectRotations",objectRotations);
  renderingShader.setUniform("objectSizes",objectSizes);
  renderingShader.setUniform("objectColours",objectColours);
  renderingShader.setUniform("objectMaterials",objectMaterials);
  
  shader(renderingShader);
  rect(0,0,width,height);

  rrY+=renderSquareSize;
  if(rrY>=1.0)
  {
    rrY=0.0;
    rrX+=renderSquareSize;
  }

  if(rrX>=1.0)
  {
    noLoop();
  }
}
