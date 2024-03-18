var cityTiles=[];
var edgeTile=null;
var tileCount=60;
var buildingChances=[0.6,0.1,0.02];

var roadColour=[0.4,0.4,0.4];
var footpathColour=[0.78,0.78,0.78];

var rr1="ffo";
var rr2="llfflorffrrfobrrbbrolbbll";

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
  var weightSum=weights.reduce((a,b)=>a+b);
  
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
    this.neighbours=[null,null,null,null]; //Holds references to the tiles connected up,right,down and left to this tile.
    this.roadConnections=0; //Holds which neighbours are connected to this one if this tile is a road piece. Each bit of the integer represents a connection to a neighbouring tile.
    this.tileType=0; //A zero value means that the tile has not been assigned a type yet.
    this.position=null;
  }
  
  //Joins two tiles together as roads.
  joinRoadTile(otherTile)
  {
    for(let i=0;i<4;i++)
    {
      let i2=2**i;
      if(this.neighbours[i]===otherTile)
      {
        if(!(this.roadConnections & i2)) //If the other tile has not been connected to this one on this side yet.
        {
          this.roadConnections+=i2;
          otherTile.joinRoadTile(this); //A connection is attempted on the other side.
        }

        break;
      }
    }
  }
  
  //Determines if a building of a specific size can be placed on this tile. This is if all the tiles are free and at least one tile has a neighbour as a road.
  canPlaceBuilding(size,buildingTiles)
  {
    var squaresAreFree=true,atLeastOneRoadSurrounds=false;

    for(let i=0,iT=this;i<size;i++,iT=iT.neighbours[0])
    {
      for(let j=0,jT=iT;j<size;j++,jT=jT.neighbours[1])
      {
        if(jT==edgeTile)
        {
          return false;
        }
        
        squaresAreFree&=!jT.tileType;
        atLeastOneRoadSurrounds|=jT.neighbours.reduce((a,b)=>a||(b.roadConnections),0);
        buildingTiles.push(jT);
      }    
    }
    
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
    this.leftDirection=(this.startingDirection+3)%4;
    this.rightDirection=(this.startingDirection+1)%4;
    this.backwardDirection=(this.startingDirection+2)%4;
  }
  
  applyRule(rule)
  {
    var newRoadBuilders=[]; //Holds the new Roadbuilders that may be used in the next road building iteration.
    

    let currentTile=this.startingTile;
    let currentDirection=this.startingDirection;
    for(let i of rule)
    {
      if(i=="o") //If a new RoadBuilder is to be created.
      {
        newRoadBuilders.push(new RoadBuilder(currentTile,currentDirection));
        continue;
      }
        
      //A new road tile is joined to the current one and then the new road tile is made the current one.
      let directions={"f":this.forwardDirection,"l":this.leftDirection,"r":this.rightDirection,"b":this.backwardDirection};
      currentDirection=directions[i];
      let newTile=currentTile.neighbours[currentDirection];
        
      if(newTile==edgeTile) //The road builder cannot continue any more.
      {
        break;
      }
        
      newTile.joinRoadTile(currentTile);
      currentTile=newTile;                
    }
    
    return newRoadBuilders;
  }
}

//Uses an L system with randomly selected rules to generate a road layout.
function generateRoadLayout(numberOfIterations,ruleWeights,rules)
{
  var currentNumberOfIterations=0;
  var initialRoadBuilder=new RoadBuilder(cityTiles[floor(tileCount/2.0)][floor(tileCount/2.0)],floor(random(0,4))); //The first road builder is placed in the middle of the city tile grid.
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
    currentNumberOfIterations++;
  }
}


function createTileGrid()
{
  //The CityTiles are created in a grid.
  edgeTile=new CityTile();
  for(let x=0;x<tileCount;x++)
  {
    var tileGridRow=[];
    for(let y=0;y<tileCount;y++)
    {
      var newCityTile=new CityTile();
      tileGridRow.push(newCityTile);
    }
    cityTiles.push(tileGridRow);
  }
  
  //The neighbours for each tile are assigned.
  for(let x=0;x<tileCount;x++)
  {
    for(let y=0;y<tileCount;y++)
    {
      //The edges of the tile grid are made up of edge tiles that are not iterated over further on and
      //have no road connections or buildings on them.
      var upNeighbour=((y==(tileCount-1)) ? edgeTile:cityTiles[x][y+1]);
      var downNeighbour=((y==0) ? edgeTile:cityTiles[x][y-1]);
      var leftNeighbour=((x==0) ? edgeTile:cityTiles[x-1][y]);
      var rightNeighbour=((x==(tileCount-1)) ? edgeTile:cityTiles[x+1][y]);
      
      cityTiles[x][y].neighbours=[upNeighbour,rightNeighbour,downNeighbour,leftNeighbour];
      cityTiles[x][y].position=[(x+0.5)-(tileCount/2.0),(y+0.5)-(tileCount/2.0),0.0];
    }
  }
}

//Determines what sort of road piece should be placed on each city tile from its road neighbour connections.
function determineRoadTiles()
{
  let cx,cy;
  cx=cy=0.0;
  let roadPieceCount=0;
  
  for(let ctX of cityTiles)
  {
    for(let ctXY of ctX)
    {
      if(ctXY.roadConnections)
      {
        ctXY.tileType=1;

        //The object type indexes and directions for every type of road connection combination. In order the road connections correspond to:
        //No road, up dead end, right dead end, right-up turn, down dead end, vertical straight, right-down turn, vertical-right t-intersection, left dead end,
        //left-up turn, horizontal straight, horizontal-up t-intersection, left-down turn, vertical-left t intersection, horizontal-down t intersection
        //cross intersection.

        let roadObjectIndices=[0,4,4,1,4,0,1,2,4,1,0,2,1,2,2,3];
        let directions=[0,0,3,3,2,1,2,3,1,0,0,0,1,1,2,0];
      
        let roadObjectIndex=roadObjectIndices[ctXY.roadConnections];
        let footpathObjectIndex=roadObjectIndex+5
        let rotation=[0.0,0.0,HALF_PI*directions[ctXY.roadConnections]];
        let scale=[0.5,0.0,0.0];

        addObject(roadObjectIndex,ctXY.position,rotation,scale,roadColour,1.0,0.0,1.0);
        addObject(footpathObjectIndex,ctXY.position,rotation,scale,footpathColour,1.0,0.0,1.0);
        
        roadPieceCount++;
        cx+=ctXY.position[0];
        cy+=ctXY.position[1];
      }
    }
  }
  
  cx/=roadPieceCount;
  cy/=roadPieceCount;
  return [cx,cy];
}

//Attempts to places buildings from largest to smallest with certain probabilities.
function determineBuildingTiles()
{
  for(let i=buildingChances.length-1;i>=0;i--)
  {
    let buildingChance=buildingChances[i];
    let buildingSize=i+1;

    for(let ctX of cityTiles)
    {
      for(let ctXY of ctX)
      {
        let buildingTiles=[];
        if(ctXY.canPlaceBuilding(buildingSize,buildingTiles)&&(random()<buildingChance)) //If a building can be placed here and the random choice to place the building here has been successful.
        {
          buildingTiles.forEach(a=>a.tileType=2); //Assigns the tiles as belonging to a building.
          let buildingX=ctXY.position[0]+((buildingSize-1)/2.0);
          let buildingY=ctXY.position[1]+((buildingSize-1)/2.0);
          addBuilding([buildingX,buildingY,0.0],float(buildingSize));
        }
      }
    }
  }
}

class SceneObject
{
  constructor(type,position,rotation,size,colour,diffuseness,roughness,refractiveIndex)
  {
    this.type=type;
    this.position=createVector(...position);
    this.rotation=rotation;
    this.size=size;
    this.colour=colour;
    this.diffuseness=diffuseness;
    this.roughness=roughness;
    this.refractiveIndex=refractiveIndex;
    this.addData();
  }
  
  addData()
  {
    this.index=currentObjectIndex;
    objectData.set(this.index,0,numberToColourArray(this.type));
    vec3ToTexture(this.index,1,objectData,this.position.array());
    vec3ToTexture(this.index,4,objectData,this.rotation);
    vec3ToTexture(this.index,7,objectData,this.size);
    vec3ToTexture(this.index,10,objectData,this.colour);
    objectData.set(this.index,13,numberToColourArray(this.diffuseness));
    objectData.set(this.index,14,numberToColourArray(this.roughness));
    objectData.set(this.index,15,numberToColourArray(this.refractiveIndex));
    currentObjectIndex++;
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
    

    if(leafObject) //If this node is a leaf node.
    {
      this.position=leafObject.position;
      this.radius=1.8*max(leafObject.size);
    }
    else //If the object is not a leaf node and will enclose two child nodes.
    {
      this.leftChild.parent=this;
      this.rightChild.parent=this;
      
      this.position=p5.Vector.add(this.leftChild.position,this.rightChild.position);
      this.position.div(2.0); //The enclosing node is centered exactly between the two child nodes.
      
      var halfSeperation=this.leftChild.position.dist(this.position);
      this.radius=halfSeperation+max(this.leftChild.radius,this.rightChild.radius); //The new node is large enough to enclose both children.
    }
        
    currentBvhNodeIndex++;
  }
 
 
  nextNodeSkip() //Assuming a left-most depth-first search is used, returns the first unexplored node (by looking at the rightChild nodes) in the BVH tree that does not include any descendant of this node.
  {
    if(!(this.parent)) //If this node is the root node then there are no more nodes to explore.
    {
      return null;
    }

    //Ancestor nodes should be searched for the first unexplored node if this is a rightChild
    //node, else the right sibling is returned.
    return (this.parent.rightChild==this) ? this.parent.nextNodeSkip():this.parent.rightChild;
  }
   
  nextNodeNormal() //Gets the next node in a depth-first traversal of the BVH tree.
  {
    //If it is a leaf node it returns the sibling if this is a leftChild node or the first unexplored node if it is a rightChild node.
    //Else it looks at left-most child nodes first.
    return (this.leafObject) ? this.nextNodeSkip():this.leftChild;
  }
  
  //Determines the paths that the shader will need to take in order to traverse the BVH tree.
  determineTraversalPaths()
  {
    this.nextNormal=this.nextNodeNormal();
    this.nextSkip=this.nextNodeSkip();
    
    if(!(this.leafObject)) //Recursively calls this function on the children if this is not a leaf node.
    {
      this.leftChild.determineTraversalPaths();
      this.rightChild.determineTraversalPaths();
    }
  }
  
  writeToBvhTexture()
  {
    vec3ToTexture(this.index,0,bvhData,this.position.array());
    bvhData.set(this.index,3,numberToColourArray(this.radius));
    
    var nextNormalIndex=(this.nextNormal) ? this.nextNormal.index:-1;
    var nextSkipIndex=(this.nextSkip) ? this.nextSkip.index:-1;
    bvhData.set(this.index,4,numberToColourArray(nextNormalIndex)); 
    bvhData.set(this.index,5,numberToColourArray(nextSkipIndex));
    
    var leafObjectIndex=(this.leafObject) ? this.leafObject.index:-1;
    bvhData.set(this.index,6,numberToColourArray(leafObjectIndex));

    if(!(this.leafObject))
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
  
  while(currentNodesToPair.length>1) //While the root node has not been created. Loops through all levels in the hierarchy.
  {
    let nodePairs=[];
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
    nodePairs.sort((a,b)=>a[2]-b[2]); //Sorts the node pairs in ascending order based on separation.
    
    var newCurrentNodesToPair=[];
    for(let i of nodePairs)
    {
      if(!((i[0].paired)||(i[1].paired))) //If both nodes have not been paired yet, they are enclosed by and made children of a new node.
      {
        newCurrentNodesToPair.push(new BvhNode(i[0],i[1],null));
        i[0].paired=i[1].paired=true;
      }
    }
    
    for(let i of currentNodesToPair) //If currentNodesToPair has an odd number of nodes then one will be unpaired; it is added to be paired in the next level of the hierarchy.
    {
      if(!(i.paired))
      {
        newCurrentNodesToPair.push(i); 
        break;
      }
    }
    
    currentNodesToPair=newCurrentNodesToPair;
  }
  
  return currentNodesToPair[0]; //The root node.
}

//Converts a number into a sequence of three bytes by converting it to base 256.
function nToB256(input)
{
  var x=input;
  var result=[0,0,0,255];

  for(let i=2;i>=0;i--)
  {
    result[i]=floor(x/(256**i));
    x%=(256**i);
  }

  return result;
}

function numberToColourArray(input)
{
  var remainingInput=(input+4096.0)*1024.0; //The input is shifted and scaled so a large range of numbers between -4096 and 4096 can be stored. 
  return nToB256(remainingInput);
}

function vec3ToTexture(iX,iY,dataTexture,inputArray)
{
  for(let i=0;i<3;i++)
  {
    dataTexture.set(iX,iY+i,numberToColourArray(inputArray[i]));
  }
}


function addObject(type,position,rotation,size,colour,diffuseness,roughness,refractiveIndex)
{
  sceneObjects.push(new SceneObject(type,position,rotation,size,colour,diffuseness,roughness,refractiveIndex));
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
  var diffuseness=weightedChoose([0.6,0.35,0.05],[1.0,0.2,0.0]);
  var roughness=weightedChoose([0.7,0.2,0.1],[0.0,0.5,1.0]);
  var refractiveIndex=weightedChoose([0.8,0.15,0.05],[100.0,1.5,1.05]);

  
  size=[scale*random(0.35,0.45),scale*random(0.35,0.45),scale*random(0.35,0.45)];

  if(buildingType==13)
  {
    size[1]=size[0]*random(0.1,0.9);
  }

  if(buildingType==14)
  {
    size[1]*=2.0;
  }
  

  addObject(buildingType,[position[0],position[1],scale*0.75],rotation,size,colour,diffuseness,roughness,refractiveIndex);
}


function preload()
{
  //Alters the p5.js renderer context function to use WebGL2.
  p5.RendererGL.prototype._initContext=function(){this.drawingContext=this.canvas.getContext('webgl2',this._pInst._glAttributes);};
  
  renderingShader=loadShader("vertexShader.glsl","rendering.glsl");
}


function setup() 
{ 
  objectData=createImage(4096,16);  
  bvhData=createImage(4096,7);
  
  objectData.loadPixels();  
  bvhData.loadPixels();

  
  addObject(10,[0.0,0.0,0.0],[0.0,0.0,0.0],[0.0,0.0,0.0],randomColour(),1.0,0.0,1.0);
  
  createTileGrid();
  var roadBuilderRules=[rr1,rr2];
  var roadBuilderRuleChances=[0.7,0.3];
  generateRoadLayout(5,roadBuilderRuleChances,roadBuilderRules);
  cityCentre=determineRoadTiles();
  determineBuildingTiles();
  
  objectData.updatePixels();
  
  var rootNode=buildBVH(sceneObjects.slice(1)); //The object representing the ground is infinite in size and is not included in the BVH.
  rootNode.determineTraversalPaths();
  rootNode.writeToBvhTexture();
  bvhData.updatePixels();

  cameraLocation=[cityCentre[0]+150.0,cityCentre[1]-150.0,150.0];
  lightD=p5.Vector.fromAngles(random(0.0,HALF_PI),random(0.0,TWO_PI)).array(); 
  
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

  renderingShader.setUniform("sunRadius",20.0);
  renderingShader.setUniform("sunI",7.5);
  renderingShader.setUniform("skyI",0.6);
  renderingShader.setUniform("lightD",lightD);
  
  renderingShader.setUniform("objectData",objectData);
  
  renderingShader.setUniform("bvhNodeCount",currentBvhNodeIndex);
  renderingShader.setUniform("bvhData",bvhData);

  
  rect(0,0,width,height);    
  frameNumber+=1.0;
}