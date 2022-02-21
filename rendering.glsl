#version 300 es

precision highp float;
precision highp int;

#define PI 3.14159
#define SOFT_SHADOW_FACTOR 16.0
#define MAXIMUM_REFLECTIONS 4


#define OBJ_ROADSTRAIGHT 0
#define OBJ_ROADCURVE 1
#define OBJ_ROADT 2
#define OBJ_ROADCROSS 3
#define OBJ_ROADEND 4
#define OBJ_FOOTPATHSTRAIGHT 5
#define OBJ_FOOTPATHCURVE 6
#define OBJ_FOOTPATHT 7
#define OBJ_FOOTPATHCROSS 8
#define OBJ_FOOTPATHEND 9
#define OBJ_PLANE 10
#define OBJ_SPHERE 11
#define OBJ_BOX 12
#define OBJ_TORUS 13
#define OBJ_CONE 14
#define OBJ_OCTAHEDRON 15
#define OBJ_TETRAHEDRON 16

#define MAT_DIFFUSE 0
#define MAT_REFLECT 1

uniform vec2 resolution;
uniform vec2 renderRegion1;
uniform vec2 renderRegion2;
uniform sampler2D currentScreen;
uniform vec3 cameraLocation;
uniform vec3 cameraForward;
uniform vec3 lightD;

uniform int objectCount;
uniform sampler2D objectTypes;
uniform sampler2D objectPositions;
uniform sampler2D objectRotations;
uniform sampler2D objectSizes;
uniform sampler2D objectColours;
uniform sampler2D objectMaterials;

uniform int bvhNodeCount;
uniform sampler2D bvhCentres;
uniform sampler2D bvhRadii;
uniform sampler2D bvhChild1;
uniform sampler2D bvhChild2;

//All SDFs are centred at position 0,0,0.
float sdfPlane(vec3 ray)
{
  return ray.z;
}

float sdfSphere(vec3 ray,float r)
{
  return length(ray)-r;
}

//Gives the relative coordinates (in XY plane distance and z axis) to the closest point in a ring of radius "r" centred at 0,0,0.
vec2 ringCoordinates(vec3 ray,float r)
{
  return vec2(length(ray.xy)-r,ray.z);
}

float sdfTorus(vec3 ray,float r1,float r2)
{
  return length(ringCoordinates(ray,r1))-r2;
}

float sdfCone(vec3 ray,float r,float h)
{
  vec2 circumfrenceCoordinates=ringCoordinates(ray,r); //The cone's side is made from the revolution of a triangle of width "r" and height "h".
  vec2 curvedSideNormal=normalize(vec2(1,r/h)); //The normal of the curved side face in the 2d cross-section.
  float sdfCurvedSide=dot(curvedSideNormal,circumfrenceCoordinates); //The signed perpendicular distance to the curved side of the cone.
  float sdfBase=-ray.z;
  return max(sdfCurvedSide,sdfBase);
}


//Gives the SDF of a rectangular prism with a width, height and depth given by the vector 2*size.
float sdfBox(vec3 ray,vec3 size)
{
  vec3 mirroredRay=abs(ray); //This mirrors the below SDF across all three dimensions, as it defines a box spanned by positions 0,0,0 to "size". The mirroring makes it symmetrical in all planes with dimensions of size*2.
  vec3 faceDistances=mirroredRay-size; //Distances to infinite planes in the XY,XZ and YZ planes.
  vec3 externalFaceDistances=max(faceDistances,vec3(0.0,0.0,0.0)); //The external face distances are set to zero if the ray is on the inside region of the plane. 
  float closestInternalFaceDistance=min(max(max(faceDistances.x,faceDistances.y),faceDistances.z),0.0); //The distance to the closest face if "ray" is inside the box. This distance is negative on the inside of the box, if the ray is outside of the box its value is set to zero.
  
  return length(externalFaceDistances)+closestInternalFaceDistance; //If two face distances are inside this gives the distance to one of the box's face, one face distance inside gives the distance to one of the box's edges and no face distances inside gives the distance to one of the box's corners. It gives the distance (negative) to the closest face if the ray is inside the box. 
}

//Gives the SDF of a 3D annulus of height h, thickness t and a radius (the distance from 0,0,0 to the centre of the solid ring's thickness) of r.
float sdfAnnulus(vec3 ray,float r,float t,float h)
{
  vec2 ringCoordinatesRay=ringCoordinates(ray,r);
  return sdfBox(vec3(ringCoordinatesRay.x,0.0,ringCoordinatesRay.y),vec3(t,0.2,h)/2.0);
}

float sdfOctahedron(vec3 ray,float r)
{
  return dot(normalize(vec3(1.0,1.0,1.0)),abs(ray)-vec3(r,0.0,0.0));
}

float sdfTetrahedron(vec3 ray,float r)
{
  //Vertex positions;
  float vc=r/3.464;
  vec3 v1=vec3(-vc,-vc,-vc);
  vec3 v2=vec3(vc,vc,-vc);
  vec3 v3=vec3(vc,-vc,vc);
  vec3 v4=vec3(-vc,vc,vc);

  //Face perpendicular distances.
  float d1=dot(normalize(v1),ray-v1);
  float d2=dot(normalize(v2),ray-v2);
  float d3=dot(normalize(v3),ray-v3);
  float d4=dot(normalize(v4),ray-v4);

  return max(d1,max(d2,max(d3,d4)));
}


float sdfRoadStraight(vec3 ray)
{
  return sdfBox(ray,vec3(0.5,0.25,0.0625));
}

float sdfRoadCurve(vec3 ray)
{
  float sdfRoadAnnulus=sdfAnnulus(ray-vec3(-0.5,0.5,0.0),0.5,0.5,0.125); //The sdf of an annulus road is the road cross section revolved around the origin point.
  return max(max(sdfRoadAnnulus,-(ray.x+0.5)),ray.y-0.5); //The annulus road is cut into a quarter to make a curved road piece.
}

float sdfRoadT(vec3 ray)
{
  return min(sdfRoadStraight(ray),sdfBox(vec3(ray.x,ray.y-0.25,ray.z),vec3(0.25,0.255,0.0625)));
}

float sdfRoadCross(vec3 ray)
{
  return min(sdfRoadStraight(ray),sdfBox(ray,vec3(0.25,0.5,0.0625)));
}

float sdfRoadEnd(vec3 ray)
{
  float cylinderSdf=sdfAnnulus(ray,0.125,0.25,0.125);
  return min(cylinderSdf,sdfBox(ray-vec3(0.0,0.25,0.0),vec3(0.25,0.25,0.0625)));
}

float sdfFootpathHalfStraight(vec3 ray)
{
  return sdfBox(ray+vec3(0.0,0.3125,0.0),vec3(0.5,0.0625,0.125)); 
}

float sdfFootpathStraight(vec3 ray)
{
  return sdfFootpathHalfStraight(-abs(ray));
}

float sdfFootpathCurve(vec3 ray)
{
  vec3 centrePosition=vec3(-0.5,0.5,0.0);
  float innerAnnulusSdf=sdfAnnulus(ray-centrePosition,0.1875,0.125,0.25);
  float outerAnnulusSdf=sdfAnnulus(ray-centrePosition,0.8125,0.125,0.25);
  float uncutFootpathSdf=min(innerAnnulusSdf,outerAnnulusSdf);
  return max(max(uncutFootpathSdf,-(ray.x+0.5)),ray.y-0.5);
}

float sdfFootpathQuarterCross(vec3 ray)
{
  return min(sdfBox(ray-vec3(0.375,0.3125,0.0),vec3(0.125,0.0625,0.125)),sdfBox(ray-vec3(0.3125,0.375,0.0),vec3(0.0625,0.125,0.125)));
}


float sdfFootpathT(vec3 ray)
{
  return min(sdfFootpathQuarterCross(vec3(abs(ray.x),ray.yz)),sdfFootpathHalfStraight(ray));
}

float sdfFootpathCross(vec3 ray)
{
  return sdfFootpathQuarterCross(abs(ray));
}

float sdfFootpathEnd(vec3 ray)
{
  float straightSdf=max(-ray.y,sdfFootpathStraight(ray.yxz));
  float curvedSdf=max(ray.y,sdfAnnulus(ray,0.3125,0.125,0.25));
  return min(straightSdf,curvedSdf);
}




//Below a 3D rotation matrix is made from rotation angles in all three axes. From https://en.wikipedia.org/wiki/Rotation_matrix
mat3 getRotationMatrix(vec3 angles)
{
  float Cx=cos(angles.x);
  float Cy=cos(angles.y);
  float Cz=cos(angles.z);
  float Sx=sin(angles.x);
  float Sy=sin(angles.y);
  float Sz=sin(angles.z);
  return mat3(Cz*Cy,(Cz*Sy*Sx)-(Sz*Cx),(Cz*Sy*Cx)+(Sz*Sx),Sz*Cy,(Sz*Sy*Sx)+(Cz*Cx),(Sz*Sy*Cx)-(Cz*Sx),(-1.0)*Sy,Cy*Sx,Cy*Cx);
}

float getRawPackedFromTexture(sampler2D inputTexture,int iX,int iY)
{
  vec4 textureData=255.0*texelFetch(inputTexture,ivec2(iX,iY),0);
  return dot(floor(textureData+0.5),vec4(1.0,256.0,65536.0,0.0));
}

float getFloatFromTexture(sampler2D inputTexture,int iX,int iY)
{
  return (getRawPackedFromTexture(inputTexture,iX,iY)/4096.0)-2000.0;
}

int getIntFromTexture(sampler2D inputTexture,int iX,int iY)
{
  float shiftedRawValue=getRawPackedFromTexture(inputTexture,iX,iY)-8388608.0;
  return int(floor(shiftedRawValue+0.5));
}

vec3 getVec3FromTexture(sampler2D inputTexture,int iX)
{
  return vec3(getFloatFromTexture(inputTexture,iX,0),getFloatFromTexture(inputTexture,iX,1),getFloatFromTexture(inputTexture,iX,2));
}


void push(out int[32] stack,out int pointer,int value)
{
  pointer+=1;
  stack[pointer]=value;
}

int pop(out int[32] stack,out int pointer)
{
  pointer-=1;
  return stack[pointer+1];
}

//Gets the SDF of a particular object based on its index.
float objectSdf(vec3 ray,int objectIndex)
{
  int currentObjectType=getIntFromTexture(objectTypes,objectIndex,0);
  vec3 currentObjectPosition=getVec3FromTexture(objectPositions,objectIndex);
  vec3 currentObjectSize=getVec3FromTexture(objectSizes,objectIndex);
  vec3 currentObjectRotation=getVec3FromTexture(objectRotations,objectIndex);

  vec3 transformedRay=ray-currentObjectPosition; //Shifts the ray to the objects frame of reference.

  transformedRay=getRotationMatrix(currentObjectRotation)*(transformedRay); //Rotates the ray in the object's frame of reference.
  float currentObjectDistance=9999.9;

  if(currentObjectType==OBJ_PLANE)
  {
    return sdfPlane(transformedRay);    
  }
  else if(currentObjectType==OBJ_ROADSTRAIGHT)
  {
    return sdfRoadStraight(transformedRay);
  }  
  else if(currentObjectType==OBJ_ROADCURVE)
  {
    return sdfRoadCurve(transformedRay);
  } 
  else if(currentObjectType==OBJ_ROADT)
  {
    return sdfRoadT(transformedRay);
  }  
  else if(currentObjectType==OBJ_ROADCROSS)
  {
    return sdfRoadCross(transformedRay);
  }  
  else if(currentObjectType==OBJ_ROADEND)
  {
    return sdfRoadEnd(transformedRay);
  }
  else if(currentObjectType==OBJ_FOOTPATHSTRAIGHT)
  {
    return sdfFootpathStraight(transformedRay);
  } 
  else if(currentObjectType==OBJ_FOOTPATHCURVE)
  {
    return sdfFootpathCurve(transformedRay);
  }
  else if(currentObjectType==OBJ_FOOTPATHT)
  {
    return sdfFootpathT(transformedRay);
  }
  else if(currentObjectType==OBJ_FOOTPATHCROSS)
  {
    return sdfFootpathCross(transformedRay);
  }
  else if(currentObjectType==OBJ_FOOTPATHEND)
  {
    return sdfFootpathEnd(transformedRay);
  }
  else if(currentObjectType==OBJ_SPHERE)
  {
    return sdfSphere(transformedRay,currentObjectSize[0]);
  }
  else if(currentObjectType==OBJ_BOX)
  {
    return sdfBox(transformedRay,currentObjectSize);
  }
  else if(currentObjectType==OBJ_TORUS)
  {
    return sdfTorus(transformedRay,currentObjectSize[0],currentObjectSize[1]);
  }
  else if(currentObjectType==OBJ_CONE)
  {
    return sdfCone(transformedRay,currentObjectSize[0],currentObjectSize[1]);
  }
  else if(currentObjectType==OBJ_OCTAHEDRON)
  {
    return sdfOctahedron(transformedRay,currentObjectSize[0]);
  }
  else if(currentObjectType==OBJ_TETRAHEDRON)
  {
    return sdfTetrahedron(transformedRay,currentObjectSize[0]);
  }
}

bool rayIntersectsBvhNode(vec3 rayO,vec3 rayD,int bvhNodeIndex)
{
  vec3 bnC=getVec3FromTexture(bvhCentres,bvhNodeIndex);
  float bnR=getFloatFromTexture(bvhRadii,bvhNodeIndex,0);
  
  vec3 bn_ray=bnC-rayO;
  float bnRayDistance=distance(bnC,rayO);
  float bn_ray_projRayD=dot(bn_ray,rayD);

  bool bnInFront=dot(bn_ray,rayD)>0.0; //If the current BVH node is not behind the ray.
  bool intersects=pow(bnRayDistance,2.0)-pow(bn_ray_projRayD,2.0)<=pow(bnR,2.0); //The ray collides with the BNH node's sphere.
  bool intersectsInFront=bnInFront&&intersects;
  bool rayInside=bnRayDistance<bnR; //The ray collides with the BVH node because it is inside it.
  return intersectsInFront||rayInside;  
}


float totalSdf(vec3 ray,vec3 rayD,out int closestObjectIndex)
{
  int nodeStack[32];
  int nodeStackPointer=-1;
  int objectStack[32];
  int objectStackPointer=-1;

  push(nodeStack,nodeStackPointer,bvhNodeCount-1); //The root node is added for exploration.
  
  //The BVH hierarchy is explored depth-first in order to exclude objects that the ray cannot possibly hit.
  while(nodeStackPointer!=-1)
  { 
    int currentNodeIndex=pop(nodeStack,nodeStackPointer);
    if(!rayIntersectsBvhNode(ray,rayD,currentNodeIndex))
    {
      continue; //The ray does not intersect this node, meaning that there are no objects below this node in the hierarchy that the ray can possibly hit.
    }

    int child1Index=getIntFromTexture(bvhChild1,currentNodeIndex,0);
    int child2Index=getIntFromTexture(bvhChild2,currentNodeIndex,0);

    if(child1Index>=9999) //It is a leaf node with a renderable object inside.
    {
      push(objectStack,objectStackPointer,child1Index-9999);
    }
    else //The child BVH nodes are added for exploration.
    {
      push(nodeStack,nodeStackPointer,child1Index);
      push(nodeStack,nodeStackPointer,child2Index);
    }
  }


  float closestObjectDistance=9999.8;
  push(objectStack,objectStackPointer,0); //The ground's SDF is always calculated.
  while(objectStackPointer!=-1) //Loops over all objects in the object stack to find the closest to the vector "ray".
  {
    int objectIndex=pop(objectStack,objectStackPointer);
    float currentObjectDistance=objectSdf(ray,objectIndex);

    if(currentObjectDistance<closestObjectDistance) //If the current object is now the closest found so far.
    {
      closestObjectIndex=objectIndex;
      closestObjectDistance=currentObjectDistance;
    }
  }

  return closestObjectDistance;
}

//Calculates the normal at a particular point of a certain object by determining the gradient of the objects's SDF at that point.
//If an SDF can be approximated by a plane on small scales, then the normal can be approximated by the normal of
//a plane, which is equal to the gradient of its SDF.
vec3 calculateNormal(vec3 p,int hitObjectIndex)
{
  float dP=0.0005; //The change in each ordinate of p to calculate the derivatives with.
  float dSdf_dx=(objectSdf(p+vec3(dP,0.0,0.0),hitObjectIndex)-objectSdf(p-vec3(dP,0.0,0.0),hitObjectIndex))/(2.0*dP);
  float dSdf_dy=(objectSdf(p+vec3(0.0,dP,0.0),hitObjectIndex)-objectSdf(p-vec3(0.0,dP,0.0),hitObjectIndex))/(2.0*dP);
  float dSdf_dz=(objectSdf(p+vec3(0.0,0.0,dP),hitObjectIndex)-objectSdf(p-vec3(0.0,0.0,dP),hitObjectIndex))/(2.0*dP);
  return vec3(dSdf_dx,dSdf_dy,dSdf_dz);
}


//Determines which object (if any) a ray begining at rayO with a direction of rayD will hit using
//the ray marching algorithm.
vec3 marchRay(in vec3 rayO,vec3 rayD,out int hitObjectIndex,out float minimumHitAngle)
{
  hitObjectIndex=-1; //The default value of negative 1 means that the ray has either gone too far or taken too many iterations to march.
  minimumHitAngle=1.0/SOFT_SHADOW_FACTOR; //This is an estimation of the smallest angle between the marching ray and an object. Used for soft shadows to simulate a non-point light source.
  vec3 ray=rayO;

  for(int i=0;i>-1;i++)
  {
    float marchDistance=length(ray-rayO);
    if((i>300)||(marchDistance>1000.0)) //A maximum of 300 marching steps or 1000 distance.
    {
      break;
    }
    
    int closestObjectIndex=0;
    float closestDistance=totalSdf(ray,rayD,closestObjectIndex);
    minimumHitAngle=min(minimumHitAngle,max(closestDistance,0.0)/(marchDistance+0.0001)); //Uses the small angle approximation tan(x)=x, assumes that the rayO-closest hit point vector is perpendicular to rayD.

    if(closestDistance<0.001) //If ray is within 0.001 if the closest object, it is considered to have hit it.
    {
      hitObjectIndex=closestObjectIndex;
      minimumHitAngle=0.0;
      break;
    }
 
    ray+=(rayD*closestDistance*1.0); //As the closest object is closestDistance away, it is safe to extend the ray along by this amount to prevent the ray from ending up inside an object.
  }

  return ray;
}

//Determines the direction that rays move out from the camera based on the pixel position.
//Rays pass through the camera apeture and hit one point on the screen like a pinhole camera.
//Can also be used to simulate an orthographic viewpoint (zero field of view from an infinite distance).
vec3 getCameraRay(vec2 screenFraction,float cameraScreenSize,out vec3 orthographicScreenPosition)
{
  vec3 cameraForwardUnit=normalize(cameraForward);
  vec3 cameraRight=cross(cameraForwardUnit,vec3(0.0,0.0,1.0));
  vec3 cameraUp=cross(cameraRight,cameraForwardUnit);
 
  float aspectRatio=resolution.y/resolution.x;
  float cameraPixelX=mix(-cameraScreenSize,cameraScreenSize,screenFraction.x);
  float cameraPixelY=mix(-cameraScreenSize,cameraScreenSize,screenFraction.y)*aspectRatio;
  vec3 cameraPixelLocation=(cameraRight*cameraPixelX)+(cameraUp*cameraPixelY); // The location of the pixel on the camera screen.
  orthographicScreenPosition=cameraLocation+cameraPixelLocation;

  return normalize(cameraPixelLocation+cameraForwardUnit); //The direction from the camera's location to the current camera pixel.
}


vec3 lambertianReflectance(vec3 n,vec3 colour,float lightI)
{
  return colour*(dot(n,normalize(lightD))*lightI);
}

out vec4 fragColour;
void main()
{
  vec2 screenFraction=gl_FragCoord.xy/resolution.xy;
  if((screenFraction.x<renderRegion1.x)||(screenFraction.x>renderRegion2.x)||(screenFraction.y<renderRegion1.y)||(screenFraction.y>renderRegion2.y)) //If the current pixel is outside the render region.
  {
    fragColour=texelFetch(currentScreen,ivec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y),0); //Use the existing pre-rendered pixels.
    return;
  }

  vec3 rayO=cameraLocation;
  getCameraRay(screenFraction,30.0,rayO); 
  vec3 rayD=normalize(cameraForward);
  //float cameraScreenSize=tan((PI/2.0)/2.0);
  //vec3 rayD=getCameraRay(screenFraction,cameraScreenSize);
  float lightI=0.7;
  
  vec3 outputColour=vec3(0.0,0.0,0.0); //The output colour of this pixel. Is initally set to black; if too many reflections take place this will be the pixel colour.
  for(int ri=0;ri<MAXIMUM_REFLECTIONS;ri++) //Loops over multiple reflections if needed.
  {
    int hitObjectIndex=0;
    float minimumHitAngle=0.0;
    vec3 hitPosition=marchRay(rayO,rayD,hitObjectIndex,minimumHitAngle);
    vec3 hitNormal=calculateNormal(hitPosition,hitObjectIndex);

    if(hitObjectIndex==-1) //If the ray has gone very far or taken too long without hitting anything it is assumed to hit the sky.
    {
      outputColour=mix(vec3(0.31,0.59,1.0),vec3(0.0,0.4,1.0),rayD.z);
      break;
    }

    //The colour and material of the hit object is determined.
    vec3 hitObjectColour=getVec3FromTexture(objectColours,hitObjectIndex); 
    int hitObjectMaterial=getIntFromTexture(objectMaterials,hitObjectIndex,0);

    
    if(hitObjectMaterial==MAT_DIFFUSE)
    {
      outputColour=lambertianReflectance(hitNormal,hitObjectColour,lightI);
      //Shadows are created by seeing if anything is blocking hitPosition in the direction of the light.
      //The hit position is slightly moved outwards in the direction of the normal so the ray does not
      //immediately collide with the object that was originally hit. To simulate an extended light source,
      //the shadow strength is proportional to the smallest angle made between an object and the vector to
      //the light source.
      int unused=0;                
      marchRay(hitPosition+(hitNormal*0.002),normalize(lightD),unused,minimumHitAngle);          
      outputColour*=(SOFT_SHADOW_FACTOR*minimumHitAngle); //Colour is shadowed depending on the minimum hit angle and a factor that controls the softness of shadows.
      break; //No more reflections need to be done.
    }
    else //The material is reflective and the colour is will be the colours of what the reflection ray hits.
    {
      vec3 hitReflect=reflect(rayD,hitNormal);
      rayO=hitPosition+(hitReflect*0.002); //The ray origin is moved to slightly outside the hit object in the direction of the reflection ray.
      rayD=hitReflect; //The ray direction is updated.
    }
  }

  fragColour=vec4(outputColour,1.0);
}