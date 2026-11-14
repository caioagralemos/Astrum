import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
export interface AvatarPose {leftShoulder:number;rightShoulder:number;leftElbow:number;rightElbow:number;leftHip:number;rightHip:number;leftKnee:number;rightKnee:number;headTurn:number;}
export const neutralPose:AvatarPose={leftShoulder:0,rightShoulder:0,leftElbow:0,rightElbow:0,leftHip:0,rightHip:0,leftKnee:0,rightKnee:0,headTurn:0};
export const posePresets:Record<string,AvatarPose>={
 Neutral:{...neutralPose},
 Floating:{...neutralPose,leftShoulder:28,rightShoulder:20,leftElbow:65,rightElbow:50,leftHip:40,rightHip:28,leftKnee:70,rightKnee:50,headTurn:-12},
 Reaching:{...neutralPose,leftShoulder:135,rightShoulder:15,leftElbow:12,rightElbow:35,leftHip:8,rightHip:-12,leftKnee:15,rightKnee:30,headTurn:20},
 Seated:{...neutralPose,leftShoulder:10,rightShoulder:10,leftElbow:85,rightElbow:85,leftHip:85,rightHip:85,leftKnee:90,rightKnee:90},
};
/** Deform both the opaque surfaces and the independent wire edges from immutable rest data. */
export function createPoseRig(body:THREE.Group,systems:THREE.Group){
 const entries:{object:THREE.Mesh;rest:Float32Array;region:string;lines:boolean}[]=[];
 for(const root of [body,systems])root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  let region='';for(let p:THREE.Object3D|null=object;p&&p!==root;p=p.parent)if(p.name)region=p.name;
  if(object instanceof LineSegments2){
   const g=object.geometry as LineSegmentsGeometry, a=g.getAttribute('instanceStart'),b=g.getAttribute('instanceEnd');
   const rest=new Float32Array(a.count*6);for(let i=0;i<a.count;i++)rest.set([a.getX(i),a.getY(i),a.getZ(i),b.getX(i),b.getY(i),b.getZ(i)],i*6);
   entries.push({object,rest,region,lines:true});
  }else{const p=object.geometry.getAttribute('position');entries.push({object,rest:new Float32Array(p.array),region,lines:false});}
 });
 const v=new THREE.Vector3(),pivot=new THREE.Vector3();
 function rotate(x:number,y:number,z:number,axis:'x'|'y'|'z',angle:number){pivot.set(x,y,z);v.sub(pivot).applyAxisAngle(axis==='x'?new THREE.Vector3(1,0,0):axis==='y'?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1),THREE.MathUtils.degToRad(angle)).add(pivot);}
 function deform(x:number,y:number,z:number,region:string,pose:AvatarPose){
  v.set(x,y,z);const side=x<0?-1:1,key=side<0?'left':'right';
  // Region names disambiguate adjoining limb and torso vertices. Vessel paths use location.
  const arm=region.endsWith('Arm')||(!region&&Math.abs(x)>.18&&y>.65&&y<1.42);
  const leg=region.endsWith('Leg')||(!region&&y<.92);
  if(arm){const elbow=pose[`${key}Elbow`];if(y<=1.071)rotate(side*.257,1.07,0,'x',-elbow);
   rotate(side*.18,1.41,0,'z',side*pose[`${key}Shoulder`]);
  }else if(leg){if(y<=.541)rotate(side*.106,.54,0,'x',pose[`${key}Knee`]);rotate(side*.079,.965,0,'x',-pose[`${key}Hip`]);}
  else if(region==='head'||region==='ears'||(!region&&y>1.53))rotate(0,1.51,0,'y',pose.headTurn);
  return v;
 }
 return {setPose(pose:AvatarPose){for(const {object,rest,region,lines} of entries){const values=new Float32Array(rest.length);for(let i=0;i<rest.length;i+=3){const p=deform(rest[i],rest[i+1],rest[i+2],region,pose);values.set([p.x,p.y,p.z],i);}
  if(lines)(object.geometry as LineSegmentsGeometry).setPositions(values);
  else{const g=object.geometry;g.setAttribute('position',new THREE.BufferAttribute(values,3));g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();}
 }body.updateMatrixWorld(true);systems.updateMatrixWorld(true);}};
}
