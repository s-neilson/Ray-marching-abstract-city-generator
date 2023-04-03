#version 300 es

precision highp float;
precision highp int;

#define PI 3.14159
#define MAXIMUM_REFLECTIONS 3
#define MAX_STACK_SIZE 14


#define MAT_DIFFUSE 0
#define MAT_REFLECT 1
uniform vec2 resolution;
uniform sampler2D currentScreen;
uniform float frameNumber;
uniform vec3 cameraLocation,cameraForward;

uniform float sunRadius,sunI,skyI;
uniform vec3 lightD;

uniform sampler2D objectData;

uniform int bvhNodeCount;
uniform sampler2D bvhData;

float randomSeed;
int objectStack[MAX_STACK_SIZE];
int objectStackPointer;

//x,y and z unit vectors.
vec2 uO=vec2(1.0,0.0);
vec3 uX,uY,uZ;

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
  vec2 curvedSideNormal=normalize(vec2(1.0,r/h)); //The normal of the curved side face in the 2d cross-section.
  float sdfCurvedSide=dot(curvedSideNormal,circumfrenceCoordinates); //The signed perpendicular distance to the curved side of the cone.
  float sdfBase=-ray.z;
  return max(sdfCurvedSide,sdfBase);
}


//Gives the SDF of a rectangular prism with a width, height and depth given by the vector 2*size.
float sdfBox(vec3 ray,vec3 size)
{
  vec3 mirroredRay=abs(ray); //This mirrors the below SDF across all three dimensions, as it defines a box spanned by positions 0,0,0 to "size". The mirroring makes it symmetrical in all planes with dimensions of size*2.
  vec3 faceDistances=mirroredRay-size; //Distances to infinite planes in the XY,XZ and YZ planes.
  vec3 externalFaceDistances=max(faceDistances,vec3(0.0)); //The external face distances are set to zero if the ray is on the inside region of the plane. 
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
  return dot(normalize(vec3(1.0)),abs(ray)-(uX*r));
}

float sdfTetrahedron(vec3 ray,float r)
{
  //Vertex positions
  vec3 vO=(uX-uY)*(r/3.464);
  vec3 v1=vO.yyy,v2=vO.xxy,v3=vO.xyx,v4=vO.yxx;

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
  return min(sdfRoadStraight(ray),sdfBox(ray-(uY*0.25),vec3(0.25,0.25,0.0625)));
}

float sdfRoadCross(vec3 ray)
{
  return min(sdfRoadStraight(ray),sdfRoadStraight(ray.yxz));
}

float sdfRoadEnd(vec3 ray)
{
  float cylinderSdf=sdfAnnulus(ray,0.125,0.25,0.125);
  return min(cylinderSdf,sdfBox(ray-(uY*0.25),vec3(0.25,0.25,0.0625)));
}

float sdfFootpathHalfStraight(vec3 ray)
{
  return sdfBox(ray+(uY*0.3125),vec3(0.5,0.0625,0.125)); 
}

float sdfFootpathStraight(vec3 ray)
{
  return sdfFootpathHalfStraight(-abs(ray));
}

float sdfFootpathCurve(vec3 ray)
{
  vec3 centrePosition=(uY-uX)*0.5;
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

//A pseudorandom number between minValue and maxValue based on the value of randomSeed.
float randomNumber(float minValue,float maxValue)
{
  float random_0_1=fract(sin(randomSeed)*22000.0); //A random number between 0 and 1.
  randomSeed+=0.7;
  return (random_0_1*(maxValue-minValue))+minValue;
}

//A random vector within the cone defined by the unit vector "n" and angular radius of "angle".
vec3 randomConeVector(vec3 n,float angle)
{
  //Including the "n" vector these make the basis vectors for the random vector.
  vec3 cBx=cross(n,vec3(0.796,0.239,-0.557));
  vec3 cBy=cross(n,cBx);

  //Uniformly randomly sampling on a cylinder and projecting to a sphere is the same as uniform random sampling on the sphere.
  float randomAngle=randomNumber(0.0,2.0*PI); //A random angle around the vector "n".
  float cCn=randomNumber(cos(angle),1.0); //The "n" vector component. Vertical distance on the unit sphere above angles less than "angle".
  float cCx=sqrt(1.0-(cCn*cCn))*sin(randomAngle);
  float cCy=sqrt(1.0-(cCn*cCn))*cos(randomAngle);

  return (n*cCn)+(cBx*cCx)+(cBy*cCy);
}

//Below a 3D rotation matrix is made from rotation angles in all three axes. From https://en.wikipedia.org/wiki/Rotation_matrix
mat3 getRotationMatrix(vec3 angles)
{
  vec3 C=cos(angles);
  vec3 S=sin(angles);
  return mat3(C.z*C.y,(C.z*S.y*S.x)-(S.z*C.x),(C.z*S.y*C.x)+(S.z*S.x),S.z*C.y,(S.z*S.y*S.x)+(C.z*C.x),(S.z*S.y*C.x)-(C.z*S.x),(-1.0)*S.y,C.y*S.x,C.y*C.x);
}


float getFloatFromTexture(sampler2D inputTexture,int iX,int iY)
{
  vec4 textureData=255.0*texelFetch(inputTexture,ivec2(iX,iY),0);
  float rawData=dot(floor(textureData+0.5),vec4(1.0,256.0,65536.0,0.0));
  return (rawData/1024.0)-4096.0;
}

int getIntFromTexture(sampler2D inputTexture,int iX,int iY)
{
  return int(floor(getFloatFromTexture(inputTexture,iX,iY)+0.5)); 
}

vec3 getVec3FromTexture(sampler2D inputTexture,int iX,int iY)
{
  return vec3(getFloatFromTexture(inputTexture,iX,iY),getFloatFromTexture(inputTexture,iX,iY+1),getFloatFromTexture(inputTexture,iX,iY+2));
}


void push(int value)
{
  if(objectStackPointer<MAX_STACK_SIZE) //Prevents the stack from overflowing.
  {
    objectStack[objectStackPointer]=value;
    objectStackPointer+=1;
  }
}


//Gets the SDF of a particular object based on its index.
float objectSdf(vec3 ray,int objectIndex)
{
  int currentObjectType=getIntFromTexture(objectData,objectIndex,0);
  vec3 currentObjectPosition=getVec3FromTexture(objectData,objectIndex,1);
  vec3 currentObjectRotation=getVec3FromTexture(objectData,objectIndex,4);
  vec3 currentObjectSize=getVec3FromTexture(objectData,objectIndex,7);

  vec3 transformedRay=ray-currentObjectPosition; //Shifts the ray to the objects frame of reference.

  transformedRay=getRotationMatrix(currentObjectRotation)*(transformedRay); //Rotates the ray in the object's frame of reference.
  float currentObjectDistance=9999.9;

  switch(currentObjectType)
  {
    case 10:
      return sdfPlane(transformedRay);    
    case 0:
      return sdfRoadStraight(transformedRay);
    case 1:
      return sdfRoadCurve(transformedRay);
    case 2:
      return sdfRoadT(transformedRay);
    case 3:
      return sdfRoadCross(transformedRay);
    case 4:
      return sdfRoadEnd(transformedRay);
    case 5:
      return sdfFootpathStraight(transformedRay);
    case 6:
      return sdfFootpathCurve(transformedRay);
    case 7:
      return sdfFootpathT(transformedRay);
    case 8:
      return sdfFootpathCross(transformedRay);
    case 9:
      return sdfFootpathEnd(transformedRay);
    case 11:
      return sdfSphere(transformedRay,currentObjectSize[0]);
    case 12:
      return sdfBox(transformedRay,currentObjectSize);
    case 13:
      return sdfTorus(transformedRay,currentObjectSize[0],currentObjectSize[1]);
    case 14:
      return sdfCone(transformedRay,currentObjectSize[0],currentObjectSize[1]);
    case 15:
      return sdfOctahedron(transformedRay,currentObjectSize[0]);
    case 16:
      return sdfTetrahedron(transformedRay,currentObjectSize[0]);
  }
}


bool rayIntersectsBvhNode(vec3 rayO,vec3 rayD,int bvhNodeIndex)
{
  vec3 bnC=getVec3FromTexture(bvhData,bvhNodeIndex,0);
  float bnR=getFloatFromTexture(bvhData,bvhNodeIndex,3);
  
  vec3 bn_ray=bnC-rayO;
  float bnRayDistance=distance(bnC,rayO);
  float bn_ray_projRayD=dot(bn_ray,rayD);

  bool bnInFront=bn_ray_projRayD>0.0; //If the current BVH node is not behind the ray.
  bool intersects=pow(bnRayDistance,2.0)-pow(bn_ray_projRayD,2.0)<=pow(bnR,2.0); //The ray collides with the BNH node's sphere.
  bool intersectsInFront=bnInFront&&intersects;
  bool rayInside=bnRayDistance<bnR; //The ray collides with the BVH node because it is inside it.
  return intersectsInFront||rayInside;  
}


void exploreBvh(vec3 ray,vec3 rayD) //Gets the only objects in the scene that the ray could possibly hit. Only the SDFs of these objects are evaluated.
{
  int currentNodeIndex=bvhNodeCount-1; //The root node is added for exploration.
  push(0); //The ground's SDF is always calculated.
  
  //The BVH hierarchy is explored depth-first in order to exclude objects that the ray cannot possibly hit.
  while(currentNodeIndex!=-1)
  { 
    int nextNodeIndex=getIntFromTexture(bvhData,currentNodeIndex,4);
    int skipNodeIndex=getIntFromTexture(bvhData,currentNodeIndex,5);
    int leafObjectIndex=getIntFromTexture(bvhData,currentNodeIndex,6);

    if(rayIntersectsBvhNode(ray,rayD,currentNodeIndex))
    {
      currentNodeIndex=nextNodeIndex; //The tree is traversed in the normal depth-first order.
    }
    else
    {
      currentNodeIndex=skipNodeIndex; //The ray does not intersect this node, meaning that there are no objects below this node in the hierarchy that the ray can possibly hit.
      continue;
    }

    if(leafObjectIndex!=-1) //The current node is a leaf node.
    {
      push(leafObjectIndex);
    }
  }  
}


float totalSdf(vec3 ray,out int closestObjectIndex)
{
  float closestObjectDistance=9999.8;

  for(int i=0;i<objectStackPointer;i++) //Loops over all objects in the object stack to find the closest to the vector "ray".
  {
    int objectIndex=objectStack[i];
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
  float dSdf_dx=(objectSdf(p+(uX*dP),hitObjectIndex)-objectSdf(p-(uX*dP),hitObjectIndex))/(2.0*dP);
  float dSdf_dy=(objectSdf(p+(uY*dP),hitObjectIndex)-objectSdf(p-(uY*dP),hitObjectIndex))/(2.0*dP);
  float dSdf_dz=(objectSdf(p+(uZ*dP),hitObjectIndex)-objectSdf(p-(uZ*dP),hitObjectIndex))/(2.0*dP);
  return vec3(dSdf_dx,dSdf_dy,dSdf_dz);
}


//Determines which object (if any) a ray begining at rayO with a direction of rayD will hit using
//the ray marching algorithm.
vec3 marchRay(in vec3 rayO,vec3 rayD,out int hitObjectIndex)
{
  hitObjectIndex=-1; //The default value of negative 1 means that the ray has either gone too far or taken too many iterations to march.
  vec3 ray=rayO;
  
  objectStackPointer=0;
  exploreBvh(ray,rayD);
  
  for(int i=0;;i++)
  {
    float marchDistance=length(ray-rayO);
    if((i>300)||(marchDistance>1000.0)) //A maximum of 300 marching steps or 1000 distance.
    {
      break;
    }
    
    int closestObjectIndex=0;
    float closestDistance=totalSdf(ray,closestObjectIndex);

    if(closestDistance<0.001) //If ray is within 0.001 if the closest object, it is considered to have hit it.
    {
      hitObjectIndex=closestObjectIndex;
      break;
    }
 
    ray+=(rayD*closestDistance*0.99); //As the closest object is closestDistance away, it is safe to extend the ray along by this amount to prevent the ray from ending up inside an object.
  }

  return ray;
}

//Determines the position that rays move out from the camera based on the pixel position.
//Camera uses an orthographic viewpoint (zero field of view from an infinite distance).
vec3 getOrthographicCameraRay(vec2 screenFraction,float cameraScreenSize)
{
  vec3 cameraForwardUnit=normalize(cameraForward);
  vec3 cameraRight=cross(cameraForwardUnit,uZ);
  vec3 cameraUp=cross(cameraRight,cameraForwardUnit);
 
  float aspectRatio=resolution.y/resolution.x;
  float cameraPixelX=mix(-cameraScreenSize,cameraScreenSize,screenFraction.x);
  float cameraPixelY=mix(-cameraScreenSize,cameraScreenSize,screenFraction.y)*aspectRatio;
  vec3 cameraPixelLocation=(cameraRight*cameraPixelX)+(cameraUp*cameraPixelY); // The location of the pixel on the camera screen.
  return cameraLocation+cameraPixelLocation;
}


out vec4 fragColour;
void main()
{
  uX=uO.xyy,uY=uO.yxy,uZ=uO.yyx;
  vec2 screenFraction=gl_FragCoord.xy/resolution.xy;
  randomSeed=dot(vec3(screenFraction,frameNumber),vec3(1500.0,-3300.0,19.2)); //Creates a unique set of random numbers for each pixel coordinate and frame number.

  float cosSunRadius=cos(sunRadius*(PI/180.0));
  float sunSolidAngle=2.0*PI*(1.0-cosSunRadius);

  vec3 rayO=getOrthographicCameraRay(screenFraction,15.0); 
  vec3 rayD=normalize(cameraForward);
  vec3 lightDU=normalize(lightD);
  
  vec3 accumulatedAttenuation=vec3(1.0); //Holds the light attenuation from the previous bounces in order to get the total contribution of the sun and sky reflecting off of the current object to the current pixel on the camera.
  vec3 outputColour=vec3(0.0); //The output colour of this pixel. Is initally set to black.
  bool isDiffuseRay=false;

  for(int ri=0;ri<MAXIMUM_REFLECTIONS;ri++) //Loops over multiple reflections if needed.
  {
    int hitObjectIndex=0;
    vec3 hitPosition=marchRay(rayO,rayD,hitObjectIndex);

    if(hitObjectIndex<0) //If the ray does not hit anything, takes to many steps or has travelled too far it is assumed to hit the sky or possibly the sun.
    {
      //If the ray does not hit anything, takes to many steps or has travelled too far it is assumed to hit the sky or possibly the sun (in the case of coming from a
      //non diffuse object as diffuse objects already sample the sun directly).
      bool shouldHitSun=(!isDiffuseRay)&&(dot(rayD,lightDU)>cosSunRadius);
      outputColour+=(accumulatedAttenuation*(shouldHitSun ? vec3(sunI):mix(vec3(0.31,0.59,1.0),vec3(0.0,0.4,1.0),rayD.z)*skyI));
      break;
    }

    vec3 hitNormal=calculateNormal(hitPosition,hitObjectIndex);

    //The colour and material of the hit object is determined.
    vec3 hitObjectColour=getVec3FromTexture(objectData,hitObjectIndex,10); 
    int hitObjectMaterial=getIntFromTexture(objectData,hitObjectIndex,13);



    
    rayO=hitPosition+(hitNormal*0.002); //Any new generated rays have their origin moved slightly above the hit location in the direction of the hit normal so they don't immediately collide with the object that was originally hit.
    
    isDiffuseRay=false;
    if(hitObjectMaterial==MAT_DIFFUSE)
    {    
      vec3 randomLightVector=randomConeVector(lightDU,(sunRadius*PI)/180.0); //A direction to a random point in the sun's disk.
      vec3 directAttenuationPerSa=(hitObjectColour/PI)*dot(hitNormal,randomLightVector); //Lambertian attenuation of the sun to the diffuse object of the current bounce.
      marchRay(rayO,randomLightVector,hitObjectIndex);   
      directAttenuationPerSa*=float(hitObjectIndex<0); //The sun contributes nothing in this bounce if the path to it is blocked by an object.
      
      outputColour+=accumulatedAttenuation*sunSolidAngle*(directAttenuationPerSa*vec3(sunI)); //The contribution of the sun's light bouncing off this object is attenuated by the previous light bounces and then added to the total.
      rayD=randomConeVector(hitNormal,PI/2.0); //A random direction within a hemisphere centred on the surface normal for the next bounce.
      vec3 indirectAttenuationPerSa=(hitObjectColour/PI)*dot(hitNormal,rayD); //Lambertian attenuation of light from the next bounce to the current object.
      accumulatedAttenuation*=indirectAttenuationPerSa*(2.0*PI-sunSolidAngle); //The current attenuation is modified to include the new bounce.
      isDiffuseRay=true;
    }
    else //The material is reflective and the colour is will be the colours of what the reflection ray hits.
    {
      vec3 hitReflect=reflect(rayD,hitNormal);
      rayD=hitReflect; //The ray direction is updated.
    }
  }

  vec3 previousColour=texelFetch(currentScreen,ivec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y),0).rgb;
  vec3 averagedColour=((previousColour*(frameNumber-1.0))+outputColour)/frameNumber; //Uses the recursive definition of averages to continuously average the frames together.
  fragColour=vec4(averagedColour,1.0);
}