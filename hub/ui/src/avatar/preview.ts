import * as THREE from 'three';
import { createPoseRig, neutralPose, posePresets } from './PoseRig.ts';
import type { AvatarPose } from './PoseRig.ts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCrewAvatar } from './CrewAvatar.ts';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createBodySystems } from './BodySystems.ts';
import type { SystemView } from './BodySystems.ts';
import type { BodyRegion } from './CrewAvatar.ts';

const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setClearColor(0x000000);
document.body.append(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.01,100);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;
controls.minDistance=1.3;
controls.maxDistance=7;
controls.target.set(0,.92,0);
const reset=()=>{camera.position.set(.82,1.10,3.65);controls.target.set(0,.92,0);controls.update();};
reset();
const avatar=createCrewAvatar();
scene.add(avatar.root);
const systems=createBodySystems();scene.add(systems.root);
const rig=createPoseRig(avatar.root,systems.root);
let pose:AvatarPose={...neutralPose};
const posePanel=document.querySelector('#pose-controls')!;
const presetRow=document.createElement('div');presetRow.className='presets';posePanel.append(presetRow);
function applyPose(){rig.setPose(pose);document.querySelectorAll<HTMLInputElement>('[data-joint]').forEach(input=>{input.value=String(pose[input.dataset.joint as keyof AvatarPose]);input.nextElementSibling!.textContent=input.value+'°';});}
for(const [name,value] of Object.entries(posePresets)){const button=document.createElement('button');button.textContent=name;button.addEventListener('click',()=>{pose={...value};applyPose();});presetRow.append(button);}
const joints:[keyof AvatarPose,string,number,number][]=[['leftShoulder','Left shoulder',-20,150],['rightShoulder','Right shoulder',-20,150],['leftElbow','Left elbow',0,135],['rightElbow','Right elbow',0,135],['leftHip','Left hip',-30,100],['rightHip','Right hip',-30,100],['leftKnee','Left knee',0,135],['rightKnee','Right knee',0,135],['headTurn','Head turn',-65,65]];
for(const [key,title,min,max] of joints){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.value='0';input.step='1';input.dataset.joint=key;input.setAttribute('aria-label',title);const output=document.createElement('output');output.textContent='0°';label.append(input,output);posePanel.append(label);input.addEventListener('input',()=>{pose[key]=Number(input.value);applyPose();});}
let current:SystemView='overview', hovered:SystemView='overview';
const descriptions:Record<SystemView,string>={overview:'Hover a region · Click to explore',heart:'Heart & blood',breathing:'Breathing & air',head:'Sleep & wellbeing',ears:'Hearing & sound exposure',resistance:'Resistance exercise',aerobic:'Aerobic exercise'};
const details:Record<SystemView,string>={overview:'Select a region on the body or use the controls below.',heart:'Heart rate · Resting rate · HRV · Blood pressure|Blood results: glucose, hemoglobin and other lab values.|No lab result loaded. This preview shows navigation only.',breathing:'Breathing rate · Blood oxygen|Room air and exposure history.|No readings loaded.',head:'Sleep duration and stages · Mood · Fatigue · Stress|Daily check-in and light exposure.|No readings loaded.',ears:'Environmental sound · Headphone exposure|Sound history and exposure duration.|No calibrated sound readings loaded.',resistance:'Resistance workouts · Sessions completed|Exercise activity, not measured muscle strength.|No workouts loaded.',aerobic:'Aerobic workouts · Exercise minutes|Exercise activity, not measured bone health.|No workouts loaded.'};
function matches(view:SystemView,region:BodyRegion){return view==='heart'||view==='breathing'?region==='chest':view==='head'?region==='head':view==='ears'?region==='ears':view==='resistance'?region.endsWith('Arm'):view==='aerobic'?region.endsWith('Leg'):false;}
function paint(){
 for(const [region,group] of avatar.regions)group.traverse(o=>{
  const selected=matches(current,region),hover=matches(hovered,region);
  const color=current==='heart'&&selected?0xf0b65f:0x9dcee8;
  if(o instanceof LineSegments2){const m=o.material as LineMaterial;m.color.setHex(selected||hover?color:current==='overview'?0xbfc6ce:0x686b70);m.linewidth=selected||hover?1.8:1.35;}
  else if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshBasicMaterial;m.color.setHex(selected?current==='heart'?0x30200f:0x152b3d:hover?0x102031:0x030507);
   // Chest halves remain independent while organs are hidden.
   m.onBeforeCompile=shader=>{if(region==='chest'&&(current==='heart'||current==='breathing'||hovered==='heart'||hovered==='breathing')){
    const v=current==='heart'||current==='breathing'?current:hovered;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float regionX;').replace('#include <begin_vertex>','#include <begin_vertex>\nregionX=position.x;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float regionX;').replace('#include <opaque_fragment>',`outgoingLight *= ${v==='heart'?'smoothstep(-0.015,0.06,regionX)':'1.0-smoothstep(-0.06,0.015,regionX)'};\n#include <opaque_fragment>`);
   }};m.customProgramCacheKey=()=>region+current+hovered;m.needsUpdate=true;
  }
 });
 renderer.domElement.style.cursor=hovered==='overview'?'grab':'pointer';
 document.querySelector('#hover')!.textContent=hovered==='overview'?'':descriptions[hovered];
}
function select(view:SystemView){current=view;systems.setView(view);paint();
 document.querySelector('#region')!.textContent=descriptions[view];
 const panel=document.querySelector('#details')!;panel.replaceChildren();
 details[view].split('|').forEach(text=>{const p=document.createElement('p');p.textContent=text;panel.append(p);});
 document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{b.addEventListener('click',()=>select(b.dataset.view as SystemView));b.addEventListener('focus',()=>{hovered=b.dataset.view as SystemView;paint();});b.addEventListener('blur',()=>{hovered='overview';paint();});});
select('overview');
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
function pick(event:PointerEvent):SystemView{
 const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
 const hit=raycaster.intersectObjects(avatar.pickTargets)[0];const region=hit?.object.userData.region as BodyRegion|undefined;
 if(region==='chest')return avatar.root.worldToLocal(hit.point.clone()).x>0?'heart':'breathing';
 if(region==='ears')return 'ears';if(region==='head')return 'head';if(region?.endsWith('Arm'))return 'resistance';if(region?.endsWith('Leg'))return 'aerobic';return 'overview';
}
let down=new THREE.Vector2();
renderer.domElement.addEventListener('pointermove',event=>{const next=pick(event);if(next!==hovered){hovered=next;paint();}});
renderer.domElement.addEventListener('pointerleave',()=>{hovered='overview';paint();});
renderer.domElement.addEventListener('pointerdown',event=>down.set(event.clientX,event.clientY));
renderer.domElement.addEventListener('pointerup',event=>{if(down.distanceTo(new THREE.Vector2(event.clientX,event.clientY))<5)select(pick(event));});
document.querySelector('#reset')!.addEventListener('click',()=>{reset();pose={...neutralPose};applyPose();select('overview');});
const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};
addEventListener('resize',resize);resize();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);controls.dispose();avatar.dispose();systems.dispose();renderer.dispose();});
