import * as api from './api/api.js';
import * as display from './display.js';
import * as imaging from './imaging.js';
//const fs=require('fs');

(async()=>{
const blueprints= await api.getResult("getBlueprints",0,0);
console.log("blueprints ",blueprints);
await display.displayBluePrints(blueprints,10,0);
await display.displayShops();

document.getElementById("browse").addEventListener("click",(event) => {
    console.log("clickd");
    display.selectTab(event, "browse");
})

document.getElementById("create").addEventListener("click",(event) => {
    display.selectTab(event,'create');
})

document.getElementById("createProduct").addEventListener("click",()=>{api.createProduct()})
document.getElementById("BGSubmit").addEventListener("click",()=>{
    const fileBG=document.getElementById("importBackgroundLink").files[0];
    const imageLink=URL.createObjectURL(fileBG);    
    console.log("imglink", imageLink);
    document.getElementById("displayBG").innerHTML=`<img src=${imageLink} style="width:300px">`;
})

document.getElementById("testProduct").addEventListener("click",()=>{api.createTestProduct()});

document.getElementById("FGSubmit").addEventListener("click",()=>{
    const fileFG=document.getElementById("importForegroundLink").files[0];
    const imageLink=URL.createObjectURL(fileFG);
    console.log("imglink", imageLink);
    document.getElementById("displayFG").innerHTML=`<img src=${imageLink} style="width:300px">`;
})
document.getElementById("textArea").addEventListener("keyup",(evt)=>{    
    const allObjects=canvas.getObjects();
    allObjects.forEach((obj)=> {
        if (obj.type==="text" || obj.type==="i-text" || obj.type ==="textbox") {
            canvas.remove(obj);
        }
    })
    const txtContent=evt.target.value;
    console.log("txt content ",txtContent)
    const text=new fabric.Text(txtContent);
    canvas.add(text);
})
document.getElementById("genImage").addEventListener("click",async ()=>{
    const desiredWidth=document.getElementById("width").value;
    const desiredHeight=document.getElementById("height").value;
    await imaging.generateImage(desiredWidth, desiredHeight);
    }   ) 
   // console.log("BGimgURLValue ",BGimgValueURL);
//document.getElementById("infoBlueprints").innerHTML=blueprint;
})()

