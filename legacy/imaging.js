//import fs from 'fs';
//import { fabric } from 'fabric';
const canvas = new fabric.Canvas('testCanvas');
export async function addImgFromField(fieldId,index) {
    const canvasWidth=canvas.getWidth();
    const canvasHeight=canvas.getHeight();
    const file=document.getElementById(fieldId).files[0]; 
    const imgDone = new Promise ((resolve, reject) => {
        if (file) {
            const newImg=URL.createObjectURL(file);
            fabric.Image.fromURL(newImg, (img)=>{     
                console.log("width ",img.width, " height ",img.height);
                const imgWidth=img.width;
                const imgHeight=img.height;
                const originalRatio=imgWidth/imgHeight;
                const desiredRatio=canvasWidth/canvasHeight;
                console.log("original width ",imgWidth, " original height ",imgHeight);
                console.log("desired width ",canvasWidth," desired height ",canvasHeight);
                console.log("original ratio ",originalRatio, " desired ratio ",desiredRatio);
                if (originalRatio<desiredRatio) {
                    if (index===0) { //if backgound image
                        img.scaleToWidth(canvasWidth);     
                    } else {
                        img.scaleToHeight(canvasHeight);    
                    }
                    console.log("new img width ", img.getScaledWidth(), " new img height ", img.getScaledHeight(), " new ratio ",img.getScaledWidth()/img.getScaledHeight());  
                } else {
                    if (index===0) { //if backgound img
                        img.scaleToHeight(canvasHeight);
                    } else {
                        img.scaleToWidth(canvasWidth);  
                    }
                    console.log("new img width ", img.getScaledWidth(), " new img height ", img.getScaledHeight(), " new ratio ",img.getScaledWidth()/img.getScaledHeight());  
                }
                img.set({
                    left: canvas.getWidth() / 2,
                    top: canvas.getHeight() / 2,
                    originX: 'center',
                    originY: 'center'
                })
                canvas.add(img);
                if (index) {
                    canvas.moveTo(img, index);
                }
                console.log("index of ",fieldId," ",canvas.getObjects().indexOf(img));        
                resolve("Done")
        }) 
        } else {
            console.log("No file");
            reject ("No file");
        }

        });
    await imgDone;
    return imgDone;
}
export async function setCanvasToSize(Width, Height) {
    canvas.setWidth(Width);                
    canvas.setHeight(Height);
    return ("done");
}
export async function generateImage(desiredWidth, desiredHeight, fileName) {
    console.log(`creating img for width: ${desiredWidth} and height: ${desiredHeight}`);
    document.getElementById("testCanvas").style.width=`${desiredWidth}px`;
    document.getElementById("testCanvas").style.height=`${desiredHeight}px`;
    const allObjects=canvas.getObjects();  
    allObjects.forEach((obj)=> {   
        canvas.remove(obj);      
    })    
    setCanvasToSize(desiredWidth,desiredHeight);
    await addImgFromField("importBackgroundLink",0);
    await addImgFromField("importForegroundLink",1);  
    const infoImg=canvas.getObjects();
    console.log("info objects ",infoImg)
    // Create a temporary URL to trigger download
    const dataURL = await canvas.toDataURL({
        format: 'png',
        quality: 1.0,
    });
    //console.log("img inside :",dataURL);
    document.getElementById("displayResult").innerHTML=`<img style="border: 1px solid black" src="${dataURL}">`;
    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);    
    const wait = () => { 
        return new Promise (resolve => {
            setTimeout(() => {
            console.log('Waited');
            resolve();} , 1000);}) }
    await wait();
    const fileMoved = await fetch('http://localhost:3000/api/movefile', 
                {method: 'POST', 
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({initialPath: `C:/Users/antoi/Downloads/${fileName}`, 
                newPath: `C:/Users/antoi/Documents/printify/app/img/${fileName}` })});    
    const response = await fileMoved.json();
    console.log(response);    
    const uploadUrl = `https://0589f42659c7.ngrok-free.app/img/${fileName}`
    return uploadUrl;
}


