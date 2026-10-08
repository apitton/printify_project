import * as api from './api/api.js'

export function selectTab(event, tabName) {
    const tabs=document.getElementsByClassName("tabContent");
    for (let el of tabs) {
        if (el.id!==tabName) {
            el.style.display="none";
        } else {
            el.style.display="block";
        }
    }
    const buttons=document.getElementsByClassName("tabSelect");
    for (let el of buttons) {
        if (el!==event.target) {
            el.className=el.className.replace(" active","");
        } else {
            el.className+=" active";
        }
    }
}
window.selectTab=selectTab;
export async function displayBluePrints (blueprints, amount, start) {  
    const toDisplay=blueprints.slice(start,Math.min(start+amount,blueprints.length-1));
    const displayHTML=`<ul>${toDisplay.map((el)=>(`<li class="blueprint" id="blueprint${el.id}">${el.title}</li>`)).join("")}</ul>
                        <button id="prev">Prev</button><button id="next">Next</button>`;
    document.getElementById("infoBlueprints").innerHTML=displayHTML;
    document.getElementById("prev").addEventListener("click",(event)=>{
        roll(event);
    })
    document.getElementById("next").addEventListener("click",(event)=>{
        roll(event);
    })
    function roll(event) {
        console.log("event.target.id ",event.target.id);
        if ((start===0 && event.target.id==="prev") || (start===blueprints.length-1 &&event.target.id==="next")) {
            console.log("limit");
            return "";
        } else {            
            //remove existing event listeners
            for (let el of toDisplay) {
                document.getElementById(`blueprint${el.id}`).removeEventListener("click",displayBlueprintDetails);
            }
            if (event.target.id==="prev") {
                console.log("prev");
                newStart=Math.max(0,start-amount);                                
            } else {
                console.log("blueprints.length-1 ",blueprints.length-1)
                newStart=Math.min(start+amount,blueprints.length-1);
            }            
            console.log("new start ",newStart);            
            displayBluePrints(blueprints, amount, newStart);
        }    } 
    
    toDisplay.forEach((el)=>{
        document.getElementById(`blueprint${el.id}`).addEventListener("click",()=>{
            displayBlueprintDetails(el);            
            displayPrintProviders(el.id);
        })
    })
}
//displayBlueprints => displayBlueprintDetails
function displayBlueprintDetails(blueprint) {
    removeClassSelected('blueprint');
    document.getElementById(`blueprint${blueprint.id}`).classList.add('selected');
    const toDisplay=`<p>Desctiption: ${blueprint.description}<br>Brand: ${blueprint.brand}<br>Model: ${blueprint.model}</p><div>${blueprint.images.map((el)=>(`<img src="${el}">`)).join(" ")}</div>`;
    //document.getElementById("blueprintDetails").innerHTML=toDisplay;
}
export async function displayPrintProviders(blueprintId) {        
    const data=await api.getResult("getPrintProviders",blueprintId,0);
    console.log(`print providers for blueprint id ${blueprintId} `,data);
    const toDisplay=`<h3>Print providers</h3><ul>${data.map((el)=>
        (`<li class="printProvider" id="printProvider${el.id}">${el.id} ${el.title}</li>`)).join("")}</ul>`;
    document.getElementById("printProviders").innerHTML=toDisplay;
    data.forEach((el)=>{
        document.getElementById(`printProvider${el.id}`).addEventListener("click",()=>{
            displayVariants(blueprintId,el.id);
            displayShipping(blueprintId,el.id);
        })
    })
}
export async function displayVariants(blueprintId, printProviderId) {
    removeClassSelected('printProvider');
    document.getElementById(`printProvider${printProviderId}`).classList.add('selected');
    const variants = await api.getResult("getVariants", blueprintId, printProviderId);
    console.log(`Variants for blueprintid ${blueprintId}, print provider ${printProviderId}`,variants);
    document.getElementById("variants").innerHTML="";
}
export async function displayShipping(blueprintId, printProviderId) {
    removeClassSelected('printProvider');
    document.getElementById(`printProvider${printProviderId}`).classList.add('selected');
    const shipping = await api.getResult("getShipping", blueprintId, printProviderId);
    console.log("shipping ",shipping);
    document.getElementById("shipping").innerHTML="";
}
export async function displayShops() {
    const shops=await api.getResult('getAllShops',"","");
    const shopsToDisplay=`<h3>Shops</h3><ul>${shops.map((shop)=>(`<li id="shop${shop.id}" class="shop">${shop.id} ${shop.title} ${shop.sales_channel}</li>`)).join("")}</ul>`;
    document.getElementById("shops").innerHTML=shopsToDisplay;
    shops.forEach((shop)=>{
        document.getElementById(`shop${shop.id}`).addEventListener("click",(event)=>{
            removeClassSelected('shop');
            event.target.classList.add('selected');
        })
    })
}
export function removeClassSelected (classTarget) {
    const items=Array.from(document.querySelectorAll(`.${classTarget}`));
    console.log("classTarget ",classTarget," items ",items);
    items.forEach((item)=>{
        if (item.classList.contains('selected')) {
            item.classList.remove('selected');
            } })};
