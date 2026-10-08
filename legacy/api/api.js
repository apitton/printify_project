import * as imaging from '../imaging.js';
import dotenv from 'dotenv';
dotenv.config();

const baseUrl="https://api.printify.com/v1/";
const token=process.env.PRINTIFY_TOKEN;


export async function getApi(targetUrl, method, body) {
    console.log("from getApi: targetUrl ",targetUrl, "method ", method, "body ",body);
    try {
        const res = await fetch(`http://localhost:3000/api/data`, {
            method: 'POST', headers: {'Content-type': 'application/json'},
            body: JSON.stringify({ 
                method: method, url: targetUrl, 
                headers: {Authorization: `Bearer ${token}`, 'Content-type': 'application/json'}, 
                body: body}
        )})
        const data = await res.json();
        console.log("Received:", data); return data;
    } catch (err) {
        console.log("Error fetching ",err);    }
}
export async function getBluePrintDetails(id) {
    const targetUrl= `${baseUrl}catalog/blueprints/${id}/print_providers.json`;    
    const data=await getApi(targetUrl, 'GET');
    return data;
}
export async function getResult(command, blueprintId, printProviderId) {
    const targetUrls={
        getBlueprints: `${baseUrl}catalog/blueprints.json`,
        getBlueprintDetails: `${baseUrl}catalog/blueprints/${blueprintId}/print_providers.json`,
        getPrintProviders: `${baseUrl}catalog/blueprints/${blueprintId}/print_providers.json`,
        getVariants: `${baseUrl}catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
        getShipping: `${baseUrl}catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/shipping.json`,
        getPrintProvider: `${baseUrl}catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/shipping.json`,
        getAllPrintProviders: `${baseUrl}catalog/print_providers.json`,
        getAllShops: `${baseUrl}shops.json`
    }
    const targetUrl=targetUrls[command];
    const data=await getApi(targetUrl,'GET');
    return data;
}
export async function getResultPOST(command, params, body) {
    console.log("command: ", command, " params :",params, "body: ", body);
    const targetURLs={
        createProduct: `${baseUrl}shops/${params.shopId}/products.json`,
        uploadImage: `${baseUrl}uploads/images.json`
    }
    const targetUrl=targetURLs[command];
    const data = await getApi(targetUrl,'POST', body);
    return data;
}

export async function getPrices(shopId) {
    const blueprints=await getResult('getBlueprints');
    for (bp of blueprints) {
        // fill db blueprints with id, model, title, brand
        //pool.query(`INSERT INTO bluesprints(id, model, title, brand) VALUES (${bp.id}, ${bp.model}, ${bp.title} ${bp.brand})`);
        blueprintId=bp.id;
        const blueprint=await getResult('getBlueprintDetails', blueprintId);    
        const providers = await getResult('getPrintProviders')
        for (provider of providers) {
            //fill db provider with id
            const providerId=provider.id
            let variants = await getResult('getVariants',blueprintId,providerId);
            variants=variants.variants;
            for (variant of variants) {
                const variantId= variant.id;

                // fill variant_details with id, size, title, placeholder,...

            }
        }
    }
}

export async function uploadImage(imgUrl, imgName) {
    const imgUploadBody = {
        "file_name": imgName,
        "url": imgUrl
    }
    const response = await getResultPOST('uploadImage', 1 /*placeholder*/, imgUploadBody);
    response = response.data;
    console.log("image upload response: ",response);
    return response;
}

/*
for each blueprint
    find suppliers
    for each supplier
        find variants
            for each variant
                find placeholders
                push all placeholders in one array containing objects {id: width_height_position, variants: [v1, v2,...], width:... , height:... , position:...}
    produce images and push them into the placeholders array
    list products:
    {"blueprintId":.., 
    "print_provider_id":, 
    "variants":[{"id":..., "price":..., "is_enabled":...}, ...], 
    "print_areas": {"variant_ids":[..., ..., ...],
                    "placeholders": 
                        [ {"position": ..., 
                         images: [
                            {"id:..., "x":..., y: ..., "scale: ..., "angle": ...,
                            "pattern": {"spacing_x":..., "spacing_y":..., "scale":..., "offset":...}
                            } ] } ] } }



*/

export async function createTestProduct(width, height, name) {
    width = 2752;
    height = 3142;    
    name="test.png";
    const fileName=`${width}-${height}-${name}`
    let imgTest = await imaging.generateImage(2752, 3142, fileName);    
    imgTest = "https://lh3.googleusercontent.com/gps-cs-s/AC9h4nqJwtxv9yYEjMYfenJJvKBs_eQoibRHTCpIm2cXX1bY1LCvKLrt1BVREAmFm7mZU7S-tXG3WyZDighxx2HApdmxhJqj2BNWgdGNMB9oT0x1_gNkiCuvRO7oGfOb07Alf4NtwVCd=w427-h240-k-no"
    const uploadImgResponse = await uploadImage(imgTest, fileName);
    console.log("upload img response ",uploadImgResponse);
    /*const imgId=uploadImgResponse.id; //to update
    const body= 
        {"blueprintId": 5, 
        "print_provider_id": 3, 
        "variants":[{"id": 17390, "price":1000, "is_enabled":true}], 
        "print_areas": {"variant_ids":[17390],
                        "placeholders": 
                            [ {"position": 'front',
                            images: [
                                {"id":imgId, "x": 0.5, "y": 0.5, "scale": 1, "angle": 0,
                                //"pattern": {"spacing_x":..., "spacing_y":..., "scale":..., "offset":...}
                                } ] } ] }
        };
    const productCreated = await getResultPOST('createProduct', {shopId: 14749343}, body);

    console.log('Product Created: ', productCreated);*/
} 

export async function createProduct(blueprintId, shopId, providerId, variants) {    
    //const blueprintId=document.querySelector('.blueprint.selected')?.id.replace("blueprint","");    
    //const shopId=document.querySelector('.shop.selected')?.id.replace("shop","");
    //const providerId=document.querySelector('.printProvider.selected')?.id.replace("printProvider","");  
    const blueprint=await getResult('getBlueprintDetails', blueprintId);
    console.log("blueprintId ",blueprintId, "shopId ",shopId, " provider ",providerId);
    console.log(document.querySelector('.shop.selected'));
    if (shopId && providerId) {        
        //let variants=await getResult('getVariants',blueprintId,providerId);
        variants=variants.variants;
        console.log("variants ",variants);
        //group variant ids        
        //const placeholders=[];//[{id:..., variantIds:[...,...,...], placeholders:[{position: front,...}]}]
        
        function groupVariantsByPlaceholders(variants) {
            const groups = {};            
            for (const variant of variants) {
                // Sort and stringify the placeholders to create a unique key
                const key = JSON.stringify(
                    [...variant.placeholders].sort((a, b) => a.position.localeCompare(b.position))
                );
                if (!groups[key]) {
                    groups[key] = {
                        variantIds: [],
                        placeholders: variant.placeholders};
                }
                groups[key].variantIds.push(variant.id);
            }
            // Return as an array
            return Object.values(groups);
            }
        function getUniqueSizes(data) {
            const sizeSet = new Set();

            data.forEach(group => {
                group.placeholders.forEach(ph => {
                const key = `${ph.width}x${ph.height}`;
                sizeSet.add(key);
                });
            });

            // Convert back to array of objects
            return Array.from(sizeSet).map(sizeStr => {
                const [width, height] = sizeStr.split('x').map(Number);
                return { width, height };
            });
            }

        const placeholders=groupVariantsByPlaceholders(variants);
        const uniqueSizes=getUniqueSizes(placeholders);
        console.log("unique sizes ",uniqueSizes);
        let imgArray=[];
        for (let size of uniqueSizes) {  
            console.log("size ", size, " size.width ",size.width, " size.height ",size.height);
            const img= await imaging.generateImage(size.width, size.height);
            console.log("image :", img);
            const newImg=document.createElement('img');
            newImg.src=img;
            document.getElementById("images").appendChild(newImg);
            imgArray.push({size:`${size.width}x${size.height}`,img});
        }
        console.log("placeholders ",placeholders);        
        console.log("imgarray ",imgArray);
        const body={
            "title": blueprint.title,
            "description": blueprint.description,
            "blueprint_id": blueprintId,
            "print_provider_id": providerId,
            "variants": variants.map((variant)=>(
                            {id: variant.id, price: 1000, is_enabled: true}
                        )),
            "print_areas": ""
        }
        const createResponse = await getResultPOST('createProduct',{shopId: shopId}, body);
        console.log("createResponse ",createResponse);
        // retrieve the costs from the response

        //calculate costs

        
    } else {
        alert('You must select a shop and a provider first');
    }
 
}