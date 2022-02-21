#version 300 es
precision mediump float;

in vec3 aPosition;

void main()
{
  vec4 vertexPosition=vec4(aPosition,1.0);
  vertexPosition.xy=(vertexPosition.xy*2.0)-vec2(1.0,1.0);
  gl_Position=vertexPosition;
}