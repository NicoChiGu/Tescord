import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface StlModelStats {
  triangleCount: number;
  dimensions: {
    x: number;
    y: number;
    z: number;
  };
}

interface StlViewerCanvasProps {
  data: ArrayBuffer;
  autoRotate?: boolean;
  resetTrigger?: number;
  onStatsReady?: (stats: StlModelStats) => void;
  className?: string;
}

export const StlViewerCanvas: React.FC<StlViewerCanvasProps> = ({
  data,
  autoRotate = false,
  resetTrigger = 0,
  onStatsReady,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const initialCameraStateRef = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // 当 autoRotate 属性变化时动态更新 controls
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // 当 resetTrigger 变化时重置相机机位和观察目标
  useEffect(() => {
    if (
      resetTrigger > 0 &&
      controlsRef.current &&
      cameraRef.current &&
      initialCameraStateRef.current
    ) {
      const { position, target } = initialCameraStateRef.current;
      cameraRef.current.position.copy(position);
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    }
  }, [resetTrigger]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrameId: number;
    let isDisposed = false;

    // 1. 初始化场景 (Scene)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18191c); // 深暗灰底色，还原工业 3D 视口质感

    // 2. 初始化相机 (Camera)
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 300;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    cameraRef.current = camera;

    // 3. 初始化渲染器 (WebGLRenderer)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);

    // 4. 灯光系统 (Lights)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x333333, 0.4);
    hemiLight.position.set(0, 500, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight1.position.set(100, 150, 100);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x8ea1e1, 0.35); // 辅助冷光补光
    dirLight2.position.set(-100, -50, -100);
    scene.add(dirLight2);

    // 5. 控制器 (OrbitControls)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 2.0;
    controlsRef.current = controls;

    // 6. 加载并解析 STL 网格
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.MeshStandardMaterial | null = null;
    let mesh: THREE.Mesh | null = null;
    let gridHelper: THREE.GridHelper | null = null;

    try {
      const loader = new STLLoader();
      geometry = loader.parse(data);

      geometry.computeBoundingBox();
      geometry.computeVertexNormals();

      const box = geometry.boundingBox || new THREE.Box3();
      const size = new THREE.Vector3();
      box.getSize(size);

      // 将几何中心移动至坐标原点
      geometry.center();

      // 提取物理统计信息
      const triangleCount = geometry.attributes.position
        ? Math.floor(geometry.attributes.position.count / 3)
        : 0;
      onStatsReady?.({
        triangleCount,
        dimensions: {
          x: size.x,
          y: size.y,
          z: size.z,
        },
      });

      // 工业级高质感双面材质 (Discord Brand 蓝青金属哑光质感)
      material = new THREE.MeshStandardMaterial({
        color: 0x5865f2,
        roughness: 0.35,
        metalness: 0.15,
        side: THREE.DoubleSide,
      });

      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // 底面网格参考线 (Grid floor)
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      gridHelper = new THREE.GridHelper(
        maxDim * 2.2,
        22,
        0x4e5058, // 中心轴深灰
        0x2b2d31, // 网格线浅灰
      );
      gridHelper.position.y = -size.y / 2;
      scene.add(gridHelper);

      // 计算相机最佳机位
      geometry.computeBoundingSphere();
      const radius = geometry.boundingSphere?.radius || maxDim / 2;
      const fovRad = (camera.fov * Math.PI) / 360;
      const fitDistance = (radius / Math.sin(fovRad)) * 1.35;

      camera.near = Math.max(0.1, fitDistance / 100);
      camera.far = fitDistance * 50;
      camera.position.set(
        fitDistance * 0.7,
        fitDistance * 0.5,
        fitDistance * 1.1,
      );
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      controls.target.set(0, 0, 0);
      controls.minDistance = fitDistance * 0.05;
      controls.maxDistance = fitDistance * 10;
      controls.update();

      // 记录初始视角以供一键重置
      initialCameraStateRef.current = {
        position: camera.position.clone(),
        target: new THREE.Vector3(0, 0, 0),
      };
    } catch (parseError) {
      console.error("[StlViewerCanvas] STL parse error:", parseError);
    }

    // 7. 渲染循环 (Render Loop)
    const animate = () => {
      if (isDisposed) return;
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // 8. 窗口尺寸自适应监听
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length || isDisposed) return;
      const entry = entries[0];
      const newWidth = Math.max(entry.contentRect.width, 100);
      const newHeight = Math.max(entry.contentRect.height, 100);

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    });
    resizeObserver.observe(container);

    // 9. 组件卸载生命周期与显存释放 (严格符合 AGENTS.md 准则)
    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();

      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      initialCameraStateRef.current = null;

      if (mesh) {
        scene.remove(mesh);
      }
      if (geometry) {
        geometry.dispose();
      }
      if (material) {
        material.dispose();
      }
      if (gridHelper) {
        scene.remove(gridHelper);
        gridHelper.geometry.dispose();
        if (Array.isArray(gridHelper.material)) {
          gridHelper.material.forEach((m) => m.dispose());
        } else {
          gridHelper.material.dispose();
        }
      }

      renderer.dispose();
      renderer.forceContextLoss();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [data]);

  return (
    <div
      ref={containerRef}
      data-testid="stl-viewer-canvas-container"
      className={`relative w-full h-full overflow-hidden select-none outline-none ${className}`}
    />
  );
};
export default StlViewerCanvas;
