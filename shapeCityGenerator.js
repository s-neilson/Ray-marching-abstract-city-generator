var cityTiles=[];
var tileCount=60;
var largeBuildingChance=0.1;
var smallBuildingChance=0.6;

var rSr1=["ffo"];
var rBlock=["llffffrrfo","llfflo","rrffro","rrffffll"];

var renderingShader=null;
var canvas=null;
var currentScreen=null;
var frameNumber=1.0;

var currentObjectIndex=0;
var currentBvhNodeIndex=0;
var sceneObjects=[];
var cameraLocation;
var lightD;

var objectData;
var bvhData;


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
    this.roadConnections=[0,0,0,0]; //Holds which neighbours are connected to this one if this tile is a road piece.
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
        if(this.roadConnections[i]==0) //If the other tile has not been connected to this one on this side yet.
        {
          this.roadConnections[i]=1;
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
      if((i.tileType!=-1)&&(i.roadConnections.toString()!="0,0,0,0")) //If this neighbouring tile is a road tile.
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
    this.startingTile=startingTile;
    this.startingDirection=startingDirection;
    
    //Various directions relative to the starting tile and direction of the RoadBuilder.
    this.forwardDirection=this.startingDirection;
    this.leftDirection=(this.startingDirection==0) ? 3:this.startingDirection-1;
    this.rightDirection=(this.startingDirection==3) ? 0:this.startingDirection+1;
    this.backwardDirection=(this.startingDirection+2)%4;
  }
  
  applyRule(rule)
  {
    var newRoadBuilders=[]; //Holds the new Roadbuilders that may be used in the next road building iteration.
    
    for(let subrule of rule) //Each subrule starts relative to the starting tile.
    {
      var currentTile=this.startingTile;
      var currentDirection=this.startingDirection;
      var exitSubrule=false; //Exits when a new RoadBuilder is to be created.
      for(let i of subrule)
      {
        switch(i) //Determines what to do for the current entry in the rulestring.
        {
          case "f":
            currentDirection=this.forwardDirection;
            break;
          case "l":
            currentDirection=this.leftDirection;
            break;
          case "r":
            currentDirection=this.rightDirection;
            break;
          case "b":
            currentDirection=this.backwardDirection;
            break;
          case "o":
            newRoadBuilders.push(new RoadBuilder(currentTile,currentDirection));
            exitSubrule=true;
            break;         
        }
        
        if(exitSubrule)
        {
          break;
        }
        
        //The new tile is joined to the current one and then the new tile is made the current one.
        var newTile=currentTile.neighbours[currentDirection];
        newTile.joinRoadTile(currentTile);
        currentTile=newTile;                
      }
    }
    
    return newRoadBuilders;
  }
}

//Uses an L system with randomly selected rules to generate a road layout.
function generateRoadLayout(numberOfIterations,ruleWeights,rules)
{
  var currentNumberOfIterations=0;
  var initialRoadBuilder=new RoadBuilder(cityTiles[floor(random(0,tileCount))][floor(random(0,tileCount))],floor(random(0,4))); //The first road builder is placed in the middle of the city tile grid.
  var roadBuilders=[initialRoadBuilder]; //The list of active RoadBuilders on the city tile grid.

  while(currentNumberOfIterations<numberOfIterations)
  {
    var newRoadBuilders=[]; 
    
    for(let currentRoadBuilder of roadBuilders)
    {
      var chosenRule=weightedChoose(ruleWeights,rules);
      newRoadBuilders.push(...currentRoadBuilder.applyRule(chosenRule));
    }
    
    roadBuilders=newRoadBuilders; //The newly created RoadBuilders are made active.
    currentNumberOfIterations+=1;
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
        case "0,1,0,1": //Horizontal straight.
          addRoadStraight(ctXY.position,0);
          break;
        case "1,0,1,0": //Vertical straight.
          addRoadStraight(ctXY.position,1);
          break;
        case "1,0,0,1": //Left-up turn.
          addRoadCurve(ctXY.position,0);
          break;
        case "1,1,0,0": //Right-up turn.
          addRoadCurve(ctXY.position,3);
          break;
        case "0,0,1,1": //Left-down turn.
          addRoadCurve(ctXY.position,1);
          break;
        case "0,1,1,0": //Right-down turn.
          addRoadCurve(ctXY.position,2);
          break;
        case "1,1,0,1": //Horizontal-up t-intersection.
          addRoadT(ctXY.position,0);
          break;
        case "0,1,1,1": //Horizontal-down t intersection.
          addRoadT(ctXY.position,2);
          break;
        case "1,0,1,1": //Vertical-left t intersection.
          addRoadT(ctXY.position,1);
          break;
        case "1,1,1,0": //Vertical-right t-intersection.
          addRoadT(ctXY.position,3);
          break;
        case "1,1,1,1": //Cross intersection.
          addRoadCross(ctXY.position);
          break; 
        case "1,0,0,0": //Up dead end.
          addRoadEnd(ctXY.position,0);
          break;
        case "0,1,0,0": //Right dead end.
          addRoadEnd(ctXY.position,3);
          break;
        case "0,0,1,0": //Down dead end.
          addRoadEnd(ctXY.position,2);
          break;
        case "0,0,0,1": //Left dead end.
          addRoadEnd(ctXY.position,1);
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
      if((ctXY.tileType==-1)&&(ctXY.roadConnections.toString()=="0,0,0,0")) //If the current tile has not been assigned yet and if this tile cannot be a road tile.
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
      if((ctXY.tileType==-1)&&(ctXY.roadConnections.toString()=="0,0,0,0")) //If the current tile has not been assigned yet and if this tile cannot be a road tile.
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

function getCityCentre()
{
  var cx=0.0,cy=0.0;
  var roadPieceCount=0;
  for(let ctX of cityTiles)
  {
    for(let ctXY of ctX)
    {
      if(ctXY.tileType==1)
      {
        roadPieceCount+=1;
        cx+=ctXY.position[0];
        cy+=ctXY.position[1];
      }
    }
  }
  
  cx/=roadPieceCount;
  cy/=roadPieceCount;
  return [cx,cy];
}

class SceneObject
{
  constructor(type,position,rotation,size,colour,material)
  {
    this.type=type;
    this.position=createVector(position[0],position[1],position[2]);
    this.rotation=rotation;
    this.size=size;
    this.colour=colour;
    this.material=material;
    this.addData();
  }
  
  addData()
  {
    this.index=currentObjectIndex;
    objectData.set(this.index,0,intToColourArray(this.type));
    vec3ToTexture(this.index,1,objectData,[this.position.x,this.position.y,this.position.z]);
    vec3ToTexture(this.index,4,objectData,this.rotation);
    vec3ToTexture(this.index,7,objectData,this.size);
    vec3ToTexture(this.index,10,objectData,this.colour);
    objectData.set(this.index,13,intToColourArray(this.material));
    currentObjectIndex+=1;
  }
}


class BvhNode //A spherical node in a ball-tree based bounding volume hierarchy.
{
  constructor(leftChild,rightChild,leafObject)
  {
    this.paired=false;
    this.index=currentBvhNodeIndex;
    this.parent=null;
    this.leftChild=leftChild;
    this.rightChild=rightChild;
    this.leafObject=leafObject;
    
    if(leafObject==null) //If the object is not a leaf node and will enclose two child nodes.
    {
      this.leftChild.parent=this;
      this.rightChild.parent=this;
      
      this.position=p5.Vector.add(this.leftChild.position,this.rightChild.position);
      this.position.div(2.0); //The enclosing node is centered exactly between the two child nodes.
      
      var halfSeperation=this.leftChild.position.dist(this.position);
      this.radius=halfSeperation+max(this.leftChild.radius,this.rightChild.radius); //The new node is large enough to enclose both children.
    }
    else //If this node is a leaf node.
    {
      this.position=leafObject.position;
      this.radius=1.8*max(leafObject.size);
    }
    
    
    vec3ToTexture(this.index,0,bvhData,[this.position.x,this.position.y,this.position.z]);
    bvhData.set(this.index,3,floatToColourArray(this.radius));
    
    var leftChildIndex=(this.leftChild==null) ? -1:this.leftChild.index;
    var rightChildIndex=(this.rightChild==null) ? -1:this.rightChild.index;
    bvhData.set(this.index,4,intToColourArray(leftChildIndex)); 
    bvhData.set(this.index,5,intToColourArray(rightChildIndex));
    
    var leafObjectIndex=(this.leafObject==null) ? -1:this.leafObject.index;
    bvhData.set(this.index,6,intToColourArray(leafObjectIndex));
    
    currentBvhNodeIndex+=1;
  }
 
 
  nextNodeSkip() //Assuming a left-most depth-first search is used, returns the first unexplored node (by looking at the rightChild nodes) in the BVH tree that does not include any descendant of this node.
  {
    if(this.parent==null) //If this node is the root node then there are no more nodes to explore.
    {
      return null;
    }
    
    if(this.parent.rightChild==this)
    {
      return this.parent.nextNodeSkip(); //Ancestor nodes should be searched for the first unexplored node if this is a rightChild node.
    }
    else //Returns the right sibling of a leftChild node.
    {
      return this.parent.rightChild;
    }
  }
   
  nextNodeNormal() //Gets the next node in a depth-first traversal of the BVH tree.
  {
    if(this.leafObject==null)
    {
      return this.leftChild; //Looks at left-most child nodes first.
    }
    else
    {
      return this.nextNodeSkip(); //Returns the sibling if this is a leftChild node or the first unexplored node if it is a rightChild node.
    }
  }
  
  //Determines the paths that the shader will need to take in order to traverse the BVH tree.
  determineTraversalPaths()
  {
    this.nextNormal=this.nextNodeNormal();
    this.nextSkip=this.nextNodeSkip();
    
    if(this.leafObject==null) //Recursively calls this function on the children if this is not a leaf node.
    {
      this.leftChild.determineTraversalPaths();
      this.rightChild.determineTraversalPaths();
    }
  }
  
  writeToBvhTexture()
  {
    vec3ToTexture(this.index,0,bvhData,[this.position.x,this.position.y,this.position.z]);
    bvhData.set(this.index,3,floatToColourArray(this.radius));
    
    var nextNormalIndex=(this.nextNormal==null) ? -1:this.nextNormal.index;
    var nextSkipIndex=(this.nextSkip==null) ? -1:this.nextSkip.index;
    bvhData.set(this.index,4,intToColourArray(nextNormalIndex)); 
    bvhData.set(this.index,5,intToColourArray(nextSkipIndex));
    
    var leafObjectIndex=(this.leafObject==null) ? -1:this.leafObject.index;
    bvhData.set(this.index,6,intToColourArray(leafObjectIndex));

    if(this.leafObject==null)
    {
      this.leftChild.writeToBvhTexture();
      this.rightChild.writeToBvhTexture();
    }
  }
}

function buildBVH(objectList)
{
  var currentNodesToPair=[];
  for(let i of objectList) //Initally set to leaf nodes containing the scene objects.
  {
    currentNodesToPair.push(new BvhNode(null,null,i));
  }
  
  while(currentNodesToPair.length>1) //While the root node has not been created. Loops through all levels in the highrarchy.
  {
    nodePairs=[];
    for(let i of currentNodesToPair) //Determines the separation between every node pair.
    {
      for(let j of currentNodesToPair)
      {
        if(i!=j)
        {
          nodePairs.push([i,j,i.position.dist(j.position)]);
        }
      }
    }   
    nodePairs.sort((a,b)=>{return a[2]-b[2];}); //Sorts the node pairs in ascending order based on separation.
    
    var newCurrentNodesToPair=[];
    for(let i of nodePairs)
    {
      var paired1=i[0].paired;
      var paired2=i[1].paired;
      if((!paired1)&&(!paired2)) //If both nodes have not been paired yet, they are enclosed by and made children of a new node.
      {
        newCurrentNodesToPair.push(new BvhNode(i[0],i[1],null));
        i[0].paired=true;
        i[1].paired=true;
      }
    }
    
    for(let i of currentNodesToPair) //If currentNodesToPair has an odd number of nodes then one will be unpaired; it is added to be paired i the next level of the highrarchy.
    {
      if(i.paired==false)
      {
        newCurrentNodesToPair.push(i); 
        break;
      }
    }
    
    currentNodesToPair=newCurrentNodesToPair;
  }
  
  return currentNodesToPair[0]; //The root node.
}



//Converts a floating point number into a sequence of three bytes by converting it to base 256. 2000 is added to the input
//and that is multiplied by 4096 so a large range of floating point values between -2000 and 2000 can be stored.
function floatToColourArray(input)
{
  var remainingInput=(input+2000.0)*4096.0; //The input is shifted and scaled.
  var column3=floor(remainingInput/65536.0); //How many of remainingInput can fit in the 256^2 column.
  remainingInput=remainingInput%65536; //The amount left over that does not fit into the 256^2 column.
  var column2=floor(remainingInput/256.0); 
  remainingInput=remainingInput%256; 
  var column1=floor(remainingInput); 
  return [column1,column2,column3,255];
}

function intToColourArray(input)
{
  var remainingInput=input+8388608;
  var column3=floor(remainingInput/65536.0);
  remainingInput=remainingInput%65536;
  var column2=floor(remainingInput/256.0); 
  remainingInput=remainingInput%256; 
  var column1=floor(remainingInput); 
  return [column1,column2,column3,255];
}

function vec3ToTexture(iX,iY,dataTexture,inputArray)
{
  dataTexture.set(iX,iY,floatToColourArray(inputArray[0]));  
  dataTexture.set(iX,iY+1,floatToColourArray(inputArray[1]));
  dataTexture.set(iX,iY+2,floatToColourArray(inputArray[2]));
}


function addObject(type,position,rotation,size,colour,material)
{
  sceneObjects.push(new SceneObject(type,position,rotation,size,colour,material));
}


function addRoadStraight(position,direction)
{
  addObject(0,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(5,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadCurve(position,direction)
{
  addObject(1,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(6,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadT(position,direction)
{
  addObject(2,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(7,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadCross(position)
{
  addObject(3,position,[0.0,0.0,0.0],[0.5,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(8,position,[0.0,0.0,0.0],[0.5,0.0,0.0],[0.78,0.78,0.78],0);
}

function addRoadEnd(position,direction)
{
  addObject(4,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.4,0.4,0.4],0);
  addObject(9,position,[0.0,0.0,HALF_PI*direction],[0.5,0.0,0.0],[0.78,0.78,0.78],0);
}

function randomColour()
{
  let hue=random(1.0);
  var sat=random(0.25,1.0);
  var br=random(0.5,1.0);
  return p5.ColorConversion._hsbaToRGBA([hue,sat,br,1.0]).slice(0,3);
}

function addBuilding(position,scale)
{
  var colour=randomColour();
  var rotation=[random(TWO_PI),random(TWO_PI),random(TWO_PI)];
  var buildingType=weightedChoose([1.0,1.0,1.0,1.0,1.0,1.0],[11,12,13,14,15,16]);
  var size=[];
  var material=weightedChoose([0.95,0.05],[0,1]);
  
  switch(buildingType)
  {
    case 11:
      size=[scale*random(0.35,0.45),0.0,0.0];
      break;
    case 12:
      size=[scale*random(0.35,0.45),scale*random(0.35,0.45),scale*random(0.35,0.45)];
      break;
    case 13:
      var r1=random(0.35,0.45);
      var r2=random(0.1,0.9)*r1;
      size=[scale*r1,scale*r2,0.0];
      break;
    case 14:
      var r=random(0.35,0.45);
      var h=random(0.7,0.9);
      size=[scale*r,scale*h,0.0];
      break;
    case 15:
      size=[random(0.35,0.45),0.0,0.0];
      break;
    case 16:
      size=[random(0.35,0.45),0.0,0.0];
      break;
  }

  addObject(buildingType,[position[0],position[1],scale*0.75],rotation,size,colour,material);
}


function preload()
{
  //The p5.js renderer context creation function is modified to use WEBGL2. Idea to do this is from https://discourse.processing.org/t/use-webgl2-in-p5js/33695.
  p5.RendererGL.prototype._initContext = function() {
  try {
    this.drawingContext =
      this.canvas.getContext('webgl2', this._pInst._glAttributes);
    if (this.drawingContext === null) {
      throw new Error('Error creating webgl context');
    } else {
      const gl = this.drawingContext;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      this._viewport = this.drawingContext.getParameter(
        this.drawingContext.VIEWPORT
      );
    }
  } catch (er) {
    throw er;
  }
};

  renderingShader=loadShader("vertexShader.glsl","rendering.glsl");
}


function setup() 
{
  //randomSeed(2);
  //randomSeed(15);
  //randomSeed(64754226562);
  
  objectData=createImage(4096,14);  
  bvhData=createImage(4096,7);
  
  objectData.loadPixels();  
  bvhData.loadPixels();

  
  addObject(10,[0.0,0.0,0.0],[0.0,0.0,0.0],[0.0,0.0,0.0],randomColour(),0);
  
  cityTiles=createTileGrid(tileCount,tileCount);
  var roadBuilderRules=[rSr1,rBlock];
  var roadBuilderRuleChances=[0.7,0.3];
  generateRoadLayout(5,roadBuilderRuleChances,roadBuilderRules);
  determineRoadTiles();
  determineBuildingTiles(largeBuildingChance,smallBuildingChance);
  
  objectData.updatePixels();
  
  var rootNode=buildBVH(sceneObjects.slice(1)); //The object representing the ground is infinite in size and is not included in the BVH.
  rootNode.determineTraversalPaths();
  rootNode.writeToBvhTexture();
  bvhData.updatePixels();

  cityCentre=getCityCentre();
  cameraLocation=[cityCentre[0]+150.0,cityCentre[1]-150.0,150.0];
  lightD=[random(-1.0,1.0),random(-1.0,1.0),random(0.1,1.0)]; 
  
  canvas=createCanvas(windowWidth,windowHeight,WEBGL);
  pixelDensity(1);
  currentScreen=createGraphics(width,height,WEBGL);
}


function draw() 
{  
  currentScreen.image(canvas,(-0.5)*width,(-0.5)*height);
  shader(renderingShader);
  renderingShader.setUniform("resolution",[width,height]);
  renderingShader.setUniform("currentScreen",currentScreen);
  renderingShader.setUniform("frameNumber",frameNumber);
  
  renderingShader.setUniform("cameraLocation",cameraLocation);
  renderingShader.setUniform("cameraForward",[-1,1,-1]);
  renderingShader.setUniform("lightD",lightD);
  
  renderingShader.setUniform("objectCount",currentObjectIndex);
  renderingShader.setUniform("objectData",objectData);
  
  renderingShader.setUniform("bvhNodeCount",currentBvhNodeIndex);
  renderingShader.setUniform("bvhData",bvhData);

  
  rect(0,0,width,height);  
  
  frameNumber+=1.0;
}
