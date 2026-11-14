import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
export type SystemView='ears'|'overview'|'heart'|'breathing'|'head'|'resistance'|'aerobic';
export function createBodySystems(){
 const root=new THREE.Group(),heart=new THREE.Group(),breathing=new THREE.Group();
 root.add(heart,breathing);
 const resources:(THREE.BufferGeometry|THREE.Material)[]=[];
 function lines(points:number[],color:number,parent:THREE.Group,width=1.3){
  const g=new LineSegmentsGeometry();g.setPositions(points);
  const m=new LineMaterial({color,linewidth:width,depthTest:false,transparent:true,opacity:.9});
  const l=new LineSegments2(g,m);l.renderOrder=5;parent.add(l);resources.push(g,m);
 }
 function solid(g:THREE.BufferGeometry,color:number,parent:THREE.Group){
  g.computeVertexNormals();
  const m=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.22,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(g,m);mesh.renderOrder=3;parent.add(mesh);
  const e=new THREE.EdgesGeometry(g,22);lines(Array.from(e.attributes.position.array),color,parent);
  resources.push(g,m,e);
 }
 function tube(a:THREE.Vector3,b:THREE.Vector3,r:number,color:number,parent:THREE.Group){
  const g=new THREE.CylinderGeometry(r,r*.8,a.distanceTo(b),5,1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));
  g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());solid(g,color,parent);
 }
 // Asymmetric, tapered anatomical abstraction, not a valentine icon.
 const hg=new THREE.IcosahedronGeometry(1,0),hp=hg.attributes.position;
 for(let i=0;i<hp.count;i++){
  const y=hp.getY(i); const taper=.65+.35*(y+1)/2;
  hp.setXYZ(i,hp.getX(i)*.054*taper+.047+(y*.012),1.30+y*.072,.035+hp.getZ(i)*.041*taper);
 }
 solid(hg,0xf0b65f,heart);
 tube(new THREE.Vector3(.035,1.345,.035),new THREE.Vector3(.029,1.405,.035),.012,0xf0b65f,heart);
 tube(new THREE.Vector3(.064,1.347,.035),new THREE.Vector3(.085,1.389,.035),.009,0xf0b65f,heart);
 const paths=[[[.04,1.34],[0,1.40],[0,1.58]],[[0,1.40],[-.19,1.38],[-.25,1.12],[-.31,.79]],[[0,1.40],[.19,1.38],[.25,1.12],[.31,.79]],[[.035,1.25],[0,1.1],[0,.96],[-.09,.86],[-.11,.53],[-.12,.12]],[[0,.96],[.09,.86],[.11,.53],[.12,.12]],[[0,1.52],[-.035,1.59]],[[0,1.52],[.035,1.59]]];
 const vessel:number[]=[];
 for(const p of paths)for(let i=1;i<p.length;i++)vessel.push(p[i-1][0],p[i-1][1],.045,p[i][0],p[i][1],.045);
 lines(vessel,0x7dabc4,heart,1.25);
 function lung(side:number){
  const rings=[ [1.16,.055,.035],[1.21,.066,.044],[1.33,.058,.045],[1.42,.022,.025] ];
  const verts:number[]=[],idx:number[]=[];
  rings.forEach(([y,w,d],r)=>{for(let i=0;i<6;i++){
   const angle=i/6*Math.PI*2;
   let x=side*(.087+Math.cos(angle)*w);
   if(side===1&&x<.075&&r<2)x+=.019;
   verts.push(x,y,.025+Math.sin(angle)*d);
  }});
  for(let r=0;r<3;r++)for(let i=0;i<6;i++){const a=r*6+i,b=r*6+(i+1)%6;idx.push(a,b,a+6,b,b+6,a+6);}
  for(let i=1;i<5;i++){idx.push(0,i+1,i,18,18+i,19+i);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);solid(g,0x9dcee8,breathing);
 }
 lung(-1);lung(1);
 tube(new THREE.Vector3(0,1.48,.025),new THREE.Vector3(0,1.36,.025),.013,0x9dcee8,breathing);
 for(const s of [-1,1])tube(new THREE.Vector3(0,1.36,.025),new THREE.Vector3(s*.066,1.32,.025),.009,0x9dcee8,breathing);
 return {root,setView(view:SystemView){heart.visible=view==='heart';breathing.visible=view==='breathing';},dispose(){resources.forEach(r=>r.dispose());root.removeFromParent();}};
}
