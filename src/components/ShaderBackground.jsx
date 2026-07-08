import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const FragmentShader = `
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx) ;
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0) )
  + i.x + vec3(0.0, i1.x, 1.0) );
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 a0 = x - floor(x + 0.5);
  vec3 g = sin(a0*15.707) + cos(h*15.707);
  vec3 norm = 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g_val = g * norm;
  vec3 m_val = m * g_val;
  return 130.0 * dot(m_val, m_val);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  
  vec2 noise_uv = uv * 2.5;
  float n1 = snoise(noise_uv + vec2(u_time * 0.04, u_time * 0.02));
  float n2 = snoise(noise_uv * 1.5 - vec2(u_time * 0.03, -u_time * 0.05) + u_mouse * 0.15);
  
  uv.x += n1 * 0.06;
  uv.y += n2 * 0.06;
  
  vec3 col1 = u_color1;
  vec3 col2 = u_color2;
  vec3 col3 = u_color3 * 0.18;
  
  float mix_factor = snoise(uv * 1.8 + vec2(u_time * 0.015, u_time * 0.01));
  vec3 color = mix(col1, col2, mix_factor * 0.5 + 0.5);
  
  float dist_to_mouse = distance(gl_FragCoord.xy / u_resolution.y, vec2(u_mouse.x * u_resolution.x / u_resolution.y, u_mouse.y));
  float mouse_glow = smoothstep(0.35, 0.0, dist_to_mouse) * 0.04;
  
  color += col3 * (n2 * 0.5 + 0.5) + u_color3 * mouse_glow;
  
  gl_FragColor = vec4(color, 1.0);
}
`;

const VertexShader = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

function ShaderPlane({ theme }) {
  const meshRef = useRef();
  const { size } = useThree();
  
  const uniforms = useMemo(() => ({
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(size.width, size.height) },
    u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
    u_color1: { value: new THREE.Color("#050a1a") },
    u_color2: { value: new THREE.Color("#0f030a") },
    u_color3: { value: new THREE.Color("#f54060") }
  }), []);

  useEffect(() => {
    uniforms.u_resolution.value.set(size.width, size.height);
  }, [size, uniforms]);

  useEffect(() => {
    let c1 = "#050a1a";
    let c2 = "#0f030a";
    let c3 = "#f54060";

    if (theme === "emerald") {
      c1 = "#020d08";
      c2 = "#030514";
      c3 = "#1ae666";
    } else if (theme === "aurora") {
      c1 = "#030a14";
      c2 = "#0d030f";
      c3 = "#26b3d9";
    } else if (theme === "solar") {
      c1 = "#0d0502";
      c2 = "#050505";
      c3 = "#f28026";
    }

    uniforms.u_color1.value.set(c1);
    uniforms.u_color2.value.set(c2);
    uniforms.u_color3.value.set(c3);
  }, [theme, uniforms]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      const x = e.clientX / window.innerWidth;
      const y = 1.0 - (e.clientY / window.innerHeight);
      uniforms.u_mouse.value.set(x, y);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [uniforms]);

  useFrame((state) => {
    if (meshRef.current) {
      uniforms.u_time.value = state.clock.getElapsedTime();
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        fragmentShader={FragmentShader}
        vertexShader={VertexShader}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

export default function ShaderBackground({ theme = "rose" }) {
  return (
    <div className="fixed inset-0 -z-10 w-full h-full bg-slate-950 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 1] }} dpr={[1, 2]}>
        <ShaderPlane theme={theme} />
      </Canvas>
    </div>
  );
}
