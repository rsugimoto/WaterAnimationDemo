//Author: Ryusuke Sugimoto

function load_json(url, callback) {
    let xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function () {
        callback(this.response);
    });
    xhr.responseType = 'json';
    xhr.open("GET", url, true);
    xhr.send();
}

String.prototype.format = function () {
    var formatted = this;
    for (var arg in arguments) {
        formatted = formatted.replace("{" + arg + "}", arguments[arg]);
    }
    return formatted;
};

let config = {
    image_id: null,
    org_path: null,
    tex_path: null,
    mask_path: null,
    json_path: null
}

let state = {
    mode: "normal",
    animate_flag: true,
    ref_imgs_open: true,
    image: null,
    stats: null,
    gui: null,
    guiControllers: null,
    ocean: null,
    renderer: null,
    camera: null,
    scene: null,
    imageChangeCount: 0,
    spheres: null,
    json_configs: null,
    current_ref_img: 1
}

function median_config(json_configs, str) {
    const median = arr => {
        const mid = Math.floor(arr.length / 2),
            nums = [...arr].sort((a, b) => a - b);
        return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    };

    values = []
    for (let i = 0; i < json_configs.length; i++) {
        values.push(json_configs[i][str]);
    }

    return median(values);
}

function onReloadImage() {
    state.imageChangeCount++;
    updateImageSelector();
    if (config.image_id == null) {
        document.getElementById("warning").style.display = "inherit";
        document.getElementById("viewer_controls").style.display = "none";
    } else {
        updateRefImages();
        updateOpenSeadragon();
        load_json(config.json_path.format(''), (json_configs) => {
            if (json_configs == null) {
                document.getElementById("warning").style.display = "inherit";
                document.getElementById("warning_inner").innerHTML = "<h1>Error 404</h1>"
                document.getElementById("viewer_controls").style.display = "none";
                document.getElementById("viewer_main").style.display = "none";
            } else {
                document.getElementById("warning").style.display = "none";
                document.getElementById("viewer_controls").style.display = "inherit";
                document.getElementById("viewer_main").style.display = "inherit";
                if (Array.isArray(json_configs))
                    state.json_configs = json_configs;
                else
                    state.json_configs = [json_configs];
                updateViewerControls(state.json_configs);
                setImageFullyLoadedCallback(() => {
                    initRenderer(state.json_configs);
                    updateDatGui(state.json_configs);
                });
            }
        });
    }
}
onReloadImage();

function setConfig(image_id) {
    config.image_id = image_id;
    config.org_path = 'data/' + image_id + '/org{0}.jpg';
    config.mask_path = 'data/' + image_id + '/msk.png';
    config.tex_path = 'data/' + image_id + '/tex{0}.jpg';
    config.json_path = 'data/' + image_id + '/config.json';
    onReloadImage();
}

/* Image Selector */
load_json("thumbnails.json", (res) => { initImageSelector(res); });
function initImageSelector(thumbnails) {

    for (const elem of document.getElementById("image_list").getElementsByTagName("li")) {
        if (elem.dataset["id"] == config.image_id) {
            elem.classList.add("current");
        }
        let div_elem = document.createElement("div");
        div_elem.className = "thumbnail";
        div_elem.style.display = "none";
        let img_elem = document.createElement("img");
        img_elem.src = thumbnails[encodeURIComponent(elem.dataset["id"])];
        div_elem.appendChild(img_elem);
        elem.appendChild(div_elem);
        elem.onmouseenter = (event) => {
            div_elem.style.display = "block";
            const diff = div_elem.getBoundingClientRect().right - window.innerWidth;
            if (diff > 0) {
                div_elem.style.transform = "translateX(calc(-50% + " + (10 - diff).toString() + "px))";
            }
        };
        elem.onmouseleave = (event) => {
            div_elem.style.display = "none";
        };
        elem.onclick = (event) => {
            setConfig(elem.dataset["id"]);
        };
    }
}
function updateImageSelector() {
    for (const elem of document.getElementById("image_list").getElementsByTagName("li")) {
        if (elem.dataset["id"] == config.image_id) {
            elem.classList.add("current");
        } else {
            elem.classList.remove("current");
        }
    }
}
/* Image Selector */

/* Ref Images */
function updateRefImages() {
    function adjustImgSize(event) {
        const elem = event.target;
        const ref_imgs_elem = document.getElementById("ref_imgs");
        if (state.ref_imgs_open) {
            if (elem.width < elem.height) ref_imgs_elem.style.display = "flex";
            else ref_imgs_elem.style.display = "grid";
        } else {
            ref_imgs_elem.style.display = "none";
        }
        if (elem.width < elem.height) {
            const width = 200 * elem.width / elem.height;
            document.getElementById("org_img").style.width = "min(" + width.toString() + "px, 30vw)";
            document.getElementById("tex_img").style.width = "min(" + width.toString() + "px, 30vw)";
            document.getElementById("mask_img").style.width = "min(" + width.toString() + "px, 30vw)";
        } else {
            document.getElementById("org_img").style.width = "min(200px, 30vw)";
            document.getElementById("tex_img").style.width = "min(200px, 30vw)";
            document.getElementById("mask_img").style.width = "min(200px, 30vw)";
        }
    }

    function show_img_full(img_path) {
        animate_flag = false;
        const elem = document.getElementById("full_image");
        const img_elem = document.getElementById("full_image_img");
        img_elem.src = img_path;
        document.getElementById("full_image_a").href = img_path;
        img_elem.onload = () => {
            elem.style.visibility = "visible";
            elem.style.opacity = 1;
        }
    }

    state.current_ref_img = 1;

    let elem = document.createElement("img");
    elem.onload = adjustImgSize;
    elem.src = config.mask_path;
    elem.style.maxHeight = "100%";
    elem.style.maxWidth = "100%";
    for (const elem of document.getElementById("mask_img").childNodes) document.getElementById("mask_img").removeChild(elem);
    document.getElementById("mask_img").appendChild(elem);
    document.getElementById("mask_img").onclick = () => { show_img_full(config.mask_path) };

    elem = document.createElement("img");
    elem.src = config.tex_path.format(state.current_ref_img);
    elem.style.maxHeight = "100%";
    elem.style.maxWidth = "100%";
    for (const elem of document.getElementById("tex_img").childNodes) document.getElementById("tex_img").removeChild(elem);
    document.getElementById("tex_img").appendChild(elem);
    document.getElementById("tex_img").onclick = () => { show_img_full(config.tex_path.format(state.current_ref_img)) };

    elem = document.createElement("img");
    elem.src = config.org_path.format(state.current_ref_img);
    elem.style.maxHeight = "100%";
    elem.style.maxWidth = "100%";
    for (const elem of document.getElementById("org_img").childNodes) document.getElementById("org_img").removeChild(elem);
    document.getElementById("org_img").appendChild(elem);
    document.getElementById("org_img").onclick = () => { show_img_full(config.org_path.format(state.current_ref_img)) };

    document.getElementById("ref_imgs_button").onclick = () => {
        state.ref_imgs_open = !state.ref_imgs_open;
        updateRefImgsState();
    }
}

function updateRefImgsState() {
    const btn_elem = document.getElementById("ref_imgs_button_icon");
    const ref_imgs_wrapper_elem = document.getElementById("ref_imgs_wrapper");
    const ref_imgs_elem = document.getElementById("ref_imgs");
    if (state.ref_imgs_open) {
        btn_elem.classList.remove("fa-expand-alt");
        btn_elem.classList.add("fa-compress-alt");
        ref_imgs_wrapper_elem.classList.remove("closed");
        const img = document.getElementById("org_img").getElementsByTagName("img")[0];
        if (img.width < img.height) ref_imgs_elem.style.display = "flex";
        else ref_imgs_elem.style.display = "grid";
    } else {
        btn_elem.classList.remove("fa-compress-alt");
        btn_elem.classList.add("fa-expand-alt");
        ref_imgs_wrapper_elem.classList.add("closed");
        ref_imgs_elem.style.display = "none";
    }
}
/* Ref Images */

/* Viewer Mode */
function update_mode() {
    if (state.mode == "normal") {
        document.getElementById("image").className = "fullPageElem";
        document.getElementById("rendering_canvas").className = "fullPageElem";
        // document.getElementById("viewer_controls").className = "fullPageElem";
        document.getElementById("org_img").style.display = "inline";
        if (state.gui != null) state.gui.open();
    } else {
        document.getElementById("image").className = "halfPageElemRight";
        document.getElementById("rendering_canvas").className = "halfPageElemLeft";
        // document.getElementById("viewer_controls").className = "halfPageElemLeft";
        document.getElementById("org_img").style.display = "none";
        if (state.gui != null) state.gui.close();
    }
    if (state.image != null) state.image.viewport.goHome();
}
update_mode();
/* Viewer Mode */

/* OpenSeadragon */
function updateOpenSeadragon() {
    if (state.image == null) {
        state.image = new OpenSeadragon.Viewer({
            id: "image",
            showNavigator: false,
            showFullPageControl: false,
            zoomInButton: "zoom-in-btn",
            zoomOutButton: "zoom-out-btn",
            homeButton: "home-btn",
            visibilityRatio: 0.0,
            animationTime: 0.5,
            maxZoomLevel: 1024,
            tileSources: {
                type: 'image',
                url: config.org_path.format(state.current_ref_img)
            }
        });
    } else {
        state.image.open({
            type: 'image',
            url: config.org_path.format(state.current_ref_img)
        });
    }
}

function setImageFullyLoadedCallback(func) {
    function inner(world, callback) {
        let tiledImage = world.getItemAt(0);
        if (typeof tiledImage === "undefined") {
            world.addOnceHandler("add-item", function () { inner(world, callback) });
            return;
        }
        if (tiledImage.getFullyLoaded()) callback();
        else tiledImage.addOnceHandler("fully-loaded-change", callback);
    }
    inner(state.image.world, func);
}

function getInitZoom() {
    const windowInnerRatio = state.image.container.clientWidth / state.image.container.clientHeight;
    const contentSize = state.image.world.getItemAt(0).getContentSize();
    const imageRatio = contentSize.x / contentSize.y;
    if (windowInnerRatio >= imageRatio) return imageRatio / windowInnerRatio;
    else return 1.0;
}
/* OpenSeadragon */

/* Viewer Controls */
function initViewerControls() {
    document.getElementById("image_info_close_btn").onclick = () => {
        const elem = document.getElementById("image_info").style;
        elem.visibility = "hidden";
        elem.opacity = 0;
        state.animate_flag = true;
    };

    document.getElementById("full_image_close_btn").onclick = () => {
        const elem = document.getElementById("full_image").style;
        elem.visibility = "hidden";
        elem.opacity = 0;
        state.animate_flag = true;
    };

    document.getElementById("info-btn").onclick = () => {
        const elem = document.getElementById("image_info").style;
        elem.visibility = "visible";
        elem.opacity = 1;
        state.animate_flag = false;

    };

    document.getElementById("full-screen-btn").onclick = () => {
        const btn_elem = document.getElementById("full-screen-btn-icon");
        if (btn_elem.classList.contains("fa-expand-arrows-alt")) {
            document.getElementById("viewer_wrapper").requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    document.getElementById("mode-switch-btn").onclick = () => {
        state.mode = state.mode == "normal" ? "side-by-side" : "normal";
        update_mode();
        setTimeout(onWindowResize, 50);
    };
}
initViewerControls();

function updateViewerControls(json_configs) {
    if (state.stats == null) {
        state.stats = new Stats();
        document.getElementById("viewer_controls").appendChild(state.stats.dom);
    }

    const info = json_configs[0]["info"];
    if (typeof (info) != "undefined") {
        if (typeof (info) == "string") document.getElementById("image_info_content").innerHTML = info;
        else document.getElementById("image_info_content").innerHTML = info.join("<br>");
    }

    let goHome = (_) => {
        const contentSize = state.image.world.getItemAt(0).getContentSize();
        const imageRatio = contentSize.y / contentSize.x;
        const canvasOuterRatio = window.innerHeight / window.innerWidth;
        const canvasInnerRatio = (window.innerHeight - document.getElementById("image_selector").clientHeight) / window.innerWidth;

        if (imageRatio < canvasInnerRatio) {
            state.image.viewport.zoomTo(getInitZoom());
            state.image.viewport.panTo(new OpenSeadragon.Point(0.5, 0.5 * imageRatio - 0.5 * ((canvasOuterRatio - canvasInnerRatio))));
        } else {
            state.image.viewport.zoomTo(getInitZoom() * Math.max(canvasInnerRatio / canvasOuterRatio, canvasInnerRatio / imageRatio));
            state.image.viewport.panTo(new OpenSeadragon.Point(0.5, 0.5 * imageRatio - (0.5 * imageRatio) * (canvasOuterRatio - canvasInnerRatio) / canvasOuterRatio));
        }
    }
    state.image.viewport.goHome = goHome;

    document.onfullscreenchange = () => {
        const btn_elem = document.getElementById("full-screen-btn-icon");
        if (window.document.fullscreenElement) {
            btn_elem.classList.remove("fa-expand-arrows-alt");
            btn_elem.classList.add("fa-compress-arrows-alt");
        } else {
            btn_elem.classList.remove("fa-compress-arrows-alt");
            btn_elem.classList.add("fa-expand-arrows-alt");
        }
    }
}
/* Viewer Controls */

/* utils */
function convertWindParams(speed, dir) {
    const windDirRad = dir * Math.PI / 180.0;
    const wind = [speed * Math.cos(windDirRad), speed * Math.sin(windDirRad)];
    return wind
}

function getCamConfig(height, angle) {
    const _cameraAngleRad = angle * Math.PI / 180.0;
    const pos = [0, height, 0];
    const lookAt = [0, height * (1.0 - Math.cos(_cameraAngleRad)), height * Math.sin(_cameraAngleRad)];
    return [pos, lookAt];
}
/* utils */

/* dat.gui */
function hexToRGB(hex) {
    let number = parseInt(hex.replace(/^#/, ''), 16);
    return [((number / 65536) % 256) / 255.0, ((number / 256) % 256) / 255.0, (number % 256) / 255.0];
}

function initDatGui() {
    let guiHelperClass = function () {
        this.timelapse = 1.0;
        this.oceanColor = "#FFFFFF";
        // this.flipLayer = false;
        this.wireframe = false;
        this.showReflection = false;
        this.showUVCoord = false;
        this.geometrySize = 1.0;
        this.camHeight = 1.0;
        this.camAngle = 1.0;
        this.camFov = 1.0;
        this.windSpeed = 1.0;
        this.windDir = 1.0;
        this.choppiness = 1.0;
        this.playbackSpeed = 1.0;
        this.toggleSphere = false;
        this.sphereRadius = 12.0;
        // this.sphereCenter = "0.0, 200.0";
        this.saveImg = () => {
            state.animate_flag = false;
            let url1 = state.renderer.domElement.toDataURL();
            let p1 = state.image.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(0.0, 0.0));
            let p2 = state.image.viewport.imageToViewerElementCoordinates(state.image.world.getItemAt(0).getContentSize());
            function clamp(p) {
                if (p.x < 0) p.x = 0;
                else if (p.x > state.renderer.domElement.clientWidth) p.x = state.renderer.domElement.clientWidth;
                if (p.y < 0) p.y = 0;
                else if (p.y > state.renderer.domElement.clientHeight) p.y = state.renderer.domElement.clientHeight;
                return p;
            }
            p1 = clamp(p1);
            p2 = clamp(p2);
            let img_x_offset = p1.x * window.devicePixelRatio;
            let img_y_offset = p1.y * window.devicePixelRatio;
            let img_width = (p2.x - p1.x) * window.devicePixelRatio;
            let img_height = (p2.y - p1.y) * window.devicePixelRatio;

            let canvas = document.createElement('canvas');
            canvas.width = img_width;
            canvas.height = img_height;
            let context = canvas.getContext('2d');
            let img = new Image();
            img.src = url1;
            img.onload = () => {
                context.drawImage(img, img_x_offset, img_y_offset, img_width, img_height, 0, 0, img_width, img_height);
                context.save();
                let url2 = canvas.toDataURL();
                let link = document.createElement('a');
                link.setAttribute('href', url2);
                link.setAttribute('target', '_blank');
                link.setAttribute('download', config.image_id + "_r.png");
                link.click();
                state.animate_flag = true;
            }
        };
        this.toggleAnimation = () => {
            state.animate_flag = !state.animate_flag;
        }
        this.randomizeSphere = () => {
            state.guiControllers.toggleSphere.setValue(true);
            update_sphere(true);
        }
    }
    let guiHelper = new guiHelperClass();
    for (let i = 0; i < 9; ++i) {
        guiHelper["sh" + i.toString()] = "0.0, 0.0, 0.0";
    }

    let update_sh_constants = function () {
        let shConstants = [];
        for (let i = 0; i < 9; ++i) {
            values = guiHelper["sh" + i.toString()].split(", ");
            shConstants.push(new THREE.Vector3(parseFloat(values[0]), parseFloat(values[1]), parseFloat(values[2])));
        }
        state.ocean.materialOcean.uniforms.u_shConstants = { value: shConstants };
        for (let i = 0; i < num_spheres; i++) {
            state.spheres[i].material.uniforms.u_shConstants = { value: shConstants };
        }
    }

    var rand_seed = 0;
    let update_sphere = function (randomize) {
        let new_radius = guiHelper["sphereRadius"];
        if (!guiHelper["toggleSphere"]) {
            new_radius = 0.0;
        }

        function mulberry32(a) {
            return function () {
                var t = a += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
        }


        rand_seed++;
        console.log(rand_seed);
        let rand = mulberry32(rand_seed); //12

        for (let i = 0; i < num_spheres; i++) {
            let sphere = state.spheres[i];
            if (randomize) {
                sphere.position.set(rand() * 400 - 200, 0.0, rand() * 500.0 - 250.0 + 350.0);
                sphere.rotation.set(2. * Math.PI * rand(), 2. * Math.PI * rand(), 2. * Math.PI * rand());
            }
            sphere.position.y = new_radius * 0.7;
            sphere.scale.x = new_radius;
            sphere.scale.y = new_radius;
            sphere.scale.z = new_radius;

            sphere.material.uniforms.u_sphere_center.value = sphere.position;
            state.ocean.materialOcean.uniforms.u_sphere_centers.value[i] = sphere.position;
            state.ocean.materialOcean.uniforms.u_sphere_rotations.value[i] = (new THREE.Matrix4()).makeRotationFromEuler(sphere.rotation).transpose();
            state.ocean.materialOcean.uniforms.u_sphere_radii.value[i] = new_radius;
        }
    }

    let update_interpolation = function () {
        state.ocean.materialOcean.uniforms.u_texture_interpolation.value = guiHelper.timelapse - 1.0;
        state.ocean.backgroundTextureMaterial.uniforms.u_texture_interpolation.value = guiHelper.timelapse - 1.0;

        function interpolate(json_configs, t, str) {
            let val1 = json_configs[Math.floor(t)][str];
            let val2 = json_configs[Math.ceil(t)][str];
            return (Math.ceil(t) - t) * val1 + (1.0 - (Math.ceil(t) - t)) * val2;
        }

        function interpolate2(json_configs, t, str1, str2) {
            let val1 = json_configs[Math.floor(t)][str1][str2];
            let val2 = json_configs[Math.ceil(t)][str1][str2];
            return (Math.ceil(t) - t) * val1 + (1.0 - (Math.ceil(t) - t)) * val2;
        }

        let t = guiHelper.timelapse - 1.0;

        //geometry
        // state.guiControllers.camHeight.setValue(interpolate(state.json_configs, t, "height"));
        // state.guiControllers.camAngle.setValue(interpolate(state.json_configs, t, "angle"));
        // state.guiControllers.camFov.setValue(interpolate(state.json_configs, t, "fov"));
        // state.guiControllers.windSpeed.setValue(interpolate(state.json_configs, t, "windspeed"));
        // state.guiControllers.windDir.setValue(interpolate(state.json_configs, t, "winddir"));
        // state.guiControllers.choppiness.setValue(interpolate(state.json_configs, t, "choppiness"));
        // state.guiControllers.geometrySize.setValue(interpolate(state.json_configs, t, "geometrySize"));

        //lighting
        function RGBToHex(r, g, b) {
            return '#' + ('00' + Math.round(r * 255.0).toString(16)).slice(-2) + ('00' + Math.round(g * 255.0).toString(16)).slice(-2) + ('00' + Math.round(b * 255.0).toString(16)).slice(-2);
        }

        let oc = [interpolate2(state.json_configs, t, "oc", 0), interpolate2(state.json_configs, t, "oc", 1), interpolate2(state.json_configs, t, "oc", 2)];
        state.guiControllers.oceanColor.setValue(RGBToHex(...oc));

        let shConstants = [];
        for (let i = 0; i < 9; ++i)
            shConstants.push(new THREE.Vector3(interpolate2(state.json_configs, t, "sh", 3 * i), interpolate2(state.json_configs, t, "sh", 3 * i + 1), interpolate2(state.json_configs, t, "sh", 3 * i + 2)));

        for (let i = 0; i < 9; ++i) {
            state.guiControllers["sh" + i.toString()].setValue((Math.round(10000 * shConstants[i].x) / 10000).toString() + ", " + (Math.round(10000 * shConstants[i].y) / 10000).toString() + ", " + (Math.round(10000 * shConstants[i].z) / 10000).toString());
        }

        update_sh_constants();

        //ref imgs and OpenSeadragon
        if (Math.round(guiHelper.timelapse) != state.current_ref_img) {
            state.current_ref_img = Math.round(guiHelper.timelapse);
            document.getElementById("tex_img").childNodes[0].src = config.tex_path.format(state.current_ref_img);
            document.getElementById("org_img").childNodes[0].src = config.org_path.format(state.current_ref_img);

            // state.image.open({
            //     type: 'image',
            //     url: config.org_path.format(state.current_ref_img)
            // });

            state.image.addTiledImage({
                tileSource: {
                    type: 'image',
                    url: config.org_path.format(state.current_ref_img)
                },
                index: 0,
                opacity: 0,
                preload: true,
                success: function (event) {
                    var tiledImage = event.item;

                    function ready() {
                        state.image.world.removeItem(state.image.world.getItemAt(1));
                        tiledImage.setOpacity(1);
                    }

                    if (tiledImage.getFullyLoaded()) {
                        ready();
                    } else {
                        tiledImage.addOnceHandler('fully-loaded-change', ready);
                    }
                }
            });
        }
    }

    let oceanChanged = function () { state.ocean.changed = true; };
    state.gui = new dat.GUI();
    state.guiControllers = {}
    // gui.add(guiHelper,"flipLayer").name("Flip Layer").onChange(function(){flipLayer(guiHelper.flipLayer)});
    state.guiControllers.timelapse = state.gui.add(guiHelper, "timelapse", 1.0, 1.0).name("Timelapse").onChange(update_interpolation);
    state.gui.add(guiHelper, "saveImg").name("Save Screenshot");
    state.gui.add(guiHelper, "toggleAnimation").name("Toggle Animation");
    state.guiControllers.wireframe = state.gui.add(guiHelper, "wireframe").name("Wireframe").onChange(function () { state.ocean.materialOcean.wireframe = guiHelper.wireframe; state.ocean.backgroundTextureMaterial.uniforms.u_disabled.value = guiHelper.wireframe; if (guiHelper.wireframe) state.renderer.setClearAlpha(0.0); else state.renderer.setClearAlpha(1.0); });
    // gui.add(guiHelper,"showReflection").name("Show Reflection").onChange(function(){ocean.materialOcean.uniforms.u_showReflection.value = guiHelper.showReflection;});
    state.gui.add(guiHelper, "showUVCoord").name("Show UV Coord").onChange(function () { state.ocean.materialOcean.uniforms.u_showUVCoord.value = guiHelper.showUVCoord; });
    state.guiControllers.geometrySize = state.gui.add(guiHelper, "geometrySize", 32, 2048).name("Geometry Size").onChange(function () { state.ocean.size = guiHelper.geometrySize; oceanChanged() });
    state.gui.add(guiHelper, "playbackSpeed", 0.05, 2.0).name("Playback Speed").onChange(function () { state.ocean.playbackSpeed = guiHelper.playbackSpeed });

    let cameraProperty = state.gui.addFolder("Camera Properties");
    state.guiControllers.camHeight = cameraProperty.add(guiHelper, "camHeight", 1, 75).name("Height").onChange(function () { const [camPos, camLookAt] = getCamConfig(guiHelper.camHeight, guiHelper.camAngle); state.camera.position.set(...camPos); state.camera.lookAt(...camLookAt); });
    state.guiControllers.camAngle = cameraProperty.add(guiHelper, "camAngle", 45, 105).name("Angle").onChange(function () { const [camPos, camLookAt] = getCamConfig(guiHelper.camHeight, guiHelper.camAngle); state.camera.position.set(...camPos); state.camera.lookAt(...camLookAt); });
    state.guiControllers.camFov = cameraProperty.add(guiHelper, "camFov", 30, 120).name("Fov").onChange(function () { state.camera.fov = guiHelper.camFov; state.camera.updateProjectionMatrix(); });
    cameraProperty.open();

    let sphereProperty = state.gui.addFolder("Beach Ball Properties");
    state.guiControllers.toggleSphere = sphereProperty.add(guiHelper, "toggleSphere").name("Visible").onChange(function () { update_sphere(false); });
    state.guiControllers.randomizeSphere = sphereProperty.add(guiHelper, "randomizeSphere").name("Shuffle");
    state.guiControllers.sphere_radius = sphereProperty.add(guiHelper, "sphereRadius", 0.0, 20.0).name("Radius").onChange(function () { update_sphere(false); });
    // state.guiControllers.sphere_center = sphereProperty.add(guiHelper,"sphereCenter").name("Sphere Center").onChange(update_sphere);
    sphereProperty.open();

    let oceanProperty = state.gui.addFolder("Ocean Properties");
    state.guiControllers.choppiness = oceanProperty.add(guiHelper, "choppiness", 0.0, 3.0).name("Choppiness").onChange(function () { state.ocean.choppiness = guiHelper.choppiness; oceanChanged() });
    state.guiControllers.windSpeed = oceanProperty.add(guiHelper, "windSpeed", 0.1, 30.0).name("Wind Speed").onChange(function () { state.ocean.wind = convertWindParams(guiHelper.windSpeed, guiHelper.windDir); oceanChanged(); });
    state.guiControllers.windDir = oceanProperty.add(guiHelper, "windDir", 0, 179).name("Wind Direction").onChange(function () { state.ocean.wind = convertWindParams(guiHelper.windSpeed, guiHelper.windDir); oceanChanged(); });

    let gui_shConstants = oceanProperty.addFolder("Spherical Harmonics Lighting");
    state.guiControllers.sh0 = gui_shConstants.add(guiHelper, "sh0").name("l=0, m=0").onFinishChange(update_sh_constants);
    state.guiControllers.sh1 = gui_shConstants.add(guiHelper, "sh1").name("l=1, m=0").onFinishChange(update_sh_constants);
    state.guiControllers.sh2 = gui_shConstants.add(guiHelper, "sh2").name("l=1, m=+1").onFinishChange(update_sh_constants);
    state.guiControllers.sh3 = gui_shConstants.add(guiHelper, "sh3").name("l=1, m=-1").onFinishChange(update_sh_constants);
    state.guiControllers.sh4 = gui_shConstants.add(guiHelper, "sh4").name("l=2, m=0").onFinishChange(update_sh_constants);
    state.guiControllers.sh5 = gui_shConstants.add(guiHelper, "sh5").name("l=2, m=+1").onFinishChange(update_sh_constants);
    state.guiControllers.sh6 = gui_shConstants.add(guiHelper, "sh6").name("l=2, m=-1").onFinishChange(update_sh_constants);
    state.guiControllers.sh7 = gui_shConstants.add(guiHelper, "sh7").name("l=2, m=+2").onFinishChange(update_sh_constants);
    state.guiControllers.sh8 = gui_shConstants.add(guiHelper, "sh8").name("l=2, m=-2").onFinishChange(update_sh_constants);
    state.guiControllers.oceanColor = oceanProperty.addColor(guiHelper, "oceanColor").name("Ocean Color").onChange(function () { [state.ocean.oceanColor.x, state.ocean.oceanColor.y, state.ocean.oceanColor.z] = hexToRGB(guiHelper.oceanColor); oceanChanged(); });
    oceanProperty.open();
    if (state.mode != "normal") state.gui.close();
    state.gui.domElement.id = "gui";

    document.getElementById("viewer_controls").appendChild(state.gui.domElement);
}
initDatGui();

function updateDatGui(json_configs) {
    function RGBToHex(r, g, b) {
        return '#' + ('00' + Math.round(r * 255.0).toString(16)).slice(-2) + ('00' + Math.round(g * 255.0).toString(16)).slice(-2) + ('00' + Math.round(b * 255.0).toString(16)).slice(-2);
    }

    state.guiControllers.camHeight.setValue(median_config(json_configs, "height"));
    state.guiControllers.camAngle.setValue(median_config(json_configs, "angle"));
    state.guiControllers.camFov.setValue(median_config(json_configs, "fov"));
    state.guiControllers.windSpeed.setValue(median_config(json_configs, "windspeed"));
    state.guiControllers.windDir.setValue(median_config(json_configs, "winddir"));
    state.guiControllers.choppiness.setValue(median_config(json_configs, ["choppiness"]));
    state.guiControllers.geometrySize.setValue(typeof (json_configs[0]["geometrySize"]) == "undefined" ? 256.0 : median_config(json_configs, "geometrySize"));
    state.guiControllers.oceanColor.setValue(RGBToHex(...json_configs[0]["oc"]));
    state.guiControllers.timelapse.max(json_configs.length);
    state.guiControllers.timelapse.setValue(1.0);
    state.guiControllers.timelapse.updateDisplay();

    let shConstants = [];
    for (let i = 0; i < 9; ++i)
        shConstants.push(new THREE.Vector3(json_configs[0]["sh"][3 * i], json_configs[0]["sh"][3 * i + 1], json_configs[0]["sh"][3 * i + 2]));

    for (let i = 0; i < 9; ++i) {
        state.guiControllers["sh" + i.toString()].setValue((Math.round(10000 * shConstants[i].x) / 10000).toString() + ", " + (Math.round(10000 * shConstants[i].y) / 10000).toString() + ", " + (Math.round(10000 * shConstants[i].z) / 10000).toString());
    }
}
/* dat.gui */

/* Renderer */
function initRenderer(json_configs) {
    let texturesLoaded = false;
    THREE.DefaultLoadingManager.onLoad = null;
    THREE.DefaultLoadingManager.onStart = (url, itemsLoaded, itemsTotal) => { texturesLoaded = itemsLoaded == itemsTotal; };
    THREE.DefaultLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => { texturesLoaded = itemsLoaded == itemsTotal; };

    let rendererDiv = document.getElementById("rendering_canvas");
    if (state.renderer == null) {
        state.renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
        state.renderer.setSize(rendererDiv.clientWidth, rendererDiv.clientHeight);
        state.renderer.setPixelRatio(window.devicePixelRatio);
        state.renderer.setClearColor(new THREE.Color(50 / 255, 50 / 255, 50 / 255));
        rendererDiv.appendChild(state.renderer.domElement);
    }

    if (state.scene == null) state.scene = new THREE.Scene();

    if (state.camera == null)
        state.camera = new THREE.PerspectiveCamera(median_config(json_configs, "fov"), state.image.world.getItemAt(0).getContentSize().x / state.image.world.getItemAt(0).getContentSize().y, 0.1, 3000.0);
    else {
        state.camera.fov = median_config(json_configs, "fov");
        state.camera.aspect = state.image.world.getItemAt(0).getContentSize().x / state.image.world.getItemAt(0).getContentSize().y;
        state.camera.near = 0.1;
        state.camera.far = 3000.0;
        state.camera.updateProjectionMatrix();
    }
    const [camPos, camLookAt] = getCamConfig(median_config(json_configs, "height"), median_config(json_configs, "angle"))
    state.camera.position.set(...camPos);
    state.camera.lookAt(...camLookAt);

    let shConstants = [];
    for (let i = 0; i < 9; ++i)
        shConstants.push(new THREE.Vector3(json_configs[0]["sh"][3 * i], json_configs[0]["sh"][3 * i + 1], json_configs[0]["sh"][3 * i + 2]));

    const image_size = state.image.world.getItemAt(0).getContentSize();
    if (state.ocean == null) {
        const wind = convertWindParams(median_config(json_configs, "windspeed"), median_config(json_configs, "winddir"));

        state.ocean = new THREE.Ocean(
            state.renderer,
            image_size,
            config.org_path,
            config.tex_path,
            config.mask_path,
            json_configs.length,
            {
                WIND: wind,
                CHOPPINESS: median_config(json_configs, "choppiness"),
                OCEAN_COLOR: json_configs[0]["oc"],
                SH_CONSTANTS: shConstants,
                GEOMETRY_SIZE: typeof (json_configs[0]["geometrySize"]) == "undefined" ? 256.0 : median_config(json_configs, ["geometrySize"])
            }
        );
        state.scene.add(state.ocean.oceanMesh);
        state.scene.add(state.ocean.backgroundTextureMesh);

        state.spheres = [];
        state.ocean.materialOcean.uniforms.u_sphere_centers.value = new Array(num_spheres);
        state.ocean.materialOcean.uniforms.u_sphere_rotations.value = new Array(num_spheres);
        state.ocean.materialOcean.uniforms.u_sphere_radii.value = new Array(num_spheres);


        function mulberry32(a) {
            return function () {
                var t = a += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
        }

        let rand = mulberry32(352); //12
        for (let i = 0; i < num_spheres; i++) {
            //add a mesh to the scene

            let geometry = new THREE.SphereGeometry(1.0, 64, 32);
            let sphereShader = THREE.ShaderLib["sphere_shader"];
            let sphereUniforms = THREE.UniformsUtils.clone(sphereShader.uniforms);
            sphereUniforms.u_shConstants = { value: shConstants };
            let material = new THREE.ShaderMaterial({
                uniforms: sphereUniforms,
                vertexShader: sphereShader.vertexShader,
                fragmentShader: sphereShader.fragmentShader,
                transparent: false
            });
            let sphere = new THREE.Mesh(geometry, material);
            sphere.material.uniforms.u_displacementMap.value = state.ocean.displacementMapFramebuffer.texture;
            sphere.material.uniforms.u_sphere_center.value = sphere.position;
            sphere.position.set(rand() * 400 - 200, 0.0, rand() * 500.0 - 250.0 + 350.0);
            sphere.rotation.set(2. * Math.PI * rand(), 2. * Math.PI * rand(), 2. * Math.PI * rand());
            sphere.scale.x = 0.0;
            sphere.scale.y = 0.0;
            sphere.scale.z = 0.0;
            state.ocean.materialOcean.uniforms.u_sphere_centers.value[i] = sphere.position;
            state.ocean.materialOcean.uniforms.u_sphere_rotations.value[i] = (new THREE.Matrix4()).makeRotationFromEuler(sphere.rotation).transpose();
            state.ocean.materialOcean.uniforms.u_sphere_radii.value[i] = 0.0;
            state.scene.add(sphere);
            state.spheres.push(sphere);
        }
    } else {
        state.ocean.updateImage(image_size, config.org_path, config.tex_path, config.mask_path, json_configs.length);
        state.ocean.materialOcean.uniforms.u_shConstants = { value: shConstants };
        for (let i = 0; i < num_spheres; i++) {
            state.spheres[i].material.uniforms.u_shConstants = { value: shConstants };
        }
    }

    // console.log(camPos, camLookAt);



    state.image.removeAllHandlers("viewport-change");
    state.image.addHandler("viewport-change", onViewPortChange);

    window.removeEventListener("resize", onWindowResize);
    window.addEventListener("resize", onWindowResize);

    onViewPortChange();

    if (texturesLoaded) animate(state.imageChangeCount);
    else THREE.DefaultLoadingManager.onLoad = () => { animate(state.imageChangeCount); };
}

function onWindowResize() {
    const rendererDiv = document.getElementById("rendering_canvas");
    state.renderer.setSize(rendererDiv.clientWidth, rendererDiv.clientHeight);
    onViewPortChange();
    state.ocean.onWindowResize();
}

function onViewPortChange() {
    const zoom = state.image.viewport.getZoom(true) / getInitZoom();
    const pan = state.image.viewport.getCenter(true);
    let centerShift = new THREE.Vector2();

    const rendererDiv = document.getElementById("rendering_canvas");
    const divRatio = rendererDiv.clientWidth / rendererDiv.clientHeight;
    const imageRatio = state.image.world.getItemAt(0).getContentSize().x / state.image.world.getItemAt(0).getContentSize().y;
    if (imageRatio > divRatio) {
        centerShift.x = pan.x;
        centerShift.y = (-pan.y + 0.5 / imageRatio) * divRatio + 0.5;
    } else {
        centerShift.x = (pan.x - 0.5) * imageRatio / divRatio + 0.5;
        centerShift.y = 1.0 - pan.y * imageRatio;
    }

    const point1 = state.image.viewport.viewerElementToImageCoordinates(new OpenSeadragon.Point(0, 0));
    const point2 = state.image.viewport.viewerElementToImageCoordinates(new OpenSeadragon.Point(rendererDiv.clientWidth, rendererDiv.clientHeight));
    state.camera.setViewOffset(
        state.image.world.getItemAt(0).getContentSize().x,
        state.image.world.getItemAt(0).getContentSize().y,
        point1.x, point1.y, point2.x - point1.x, point2.y - point1.y
    );

    state.ocean.onViewportChange(zoom, centerShift);
}

function render() {
    if (typeof render.lastTime == 'undefined') render.lastTime = Date.now();

    let currentTime = Date.now();
    state.ocean.deltaTime = (currentTime - render.lastTime) / 1000 || 0.0;
    render.lastTime = currentTime;

    state.ocean.render();
    if (state.ocean.changed) {
        state.ocean.materialOcean.uniforms.u_size.value = state.ocean.size;
        state.ocean.materialFilterBoundaryRayCollision.uniforms.u_size.value = state.ocean.size;
        for (let i = 0; i < num_spheres; i++) {
            state.spheres[i].material.uniforms.u_size.value = state.ocean.size;
        }
        state.ocean.changed = false;
    }

    state.scene.overrideMaterial = state.ocean.materialFilterBoundaryRayCollision;
    state.ocean.materialFilterBoundaryRayCollision.uniforms.u_vpMatrix.value = ((new THREE.Matrix4()).multiply(state.camera.projectionMatrix)).multiply(state.camera.matrixWorldInverse);
    state.ocean.materialFilterBoundaryRayCollision.uniforms.u_vpMatrixInverse.value = ((new THREE.Matrix4()).multiply(state.camera.matrixWorld)).multiply(state.camera.projectionMatrixInverse);

    state.ocean.materialFilterBoundaryRayCollision.uniforms.u_cameraPosition.value = state.camera.position;
    state.renderer.setRenderTarget(state.ocean.filterBoundaryRayCollisionFramebuffer);
    state.renderer.render(state.scene, state.camera);

    state.scene.overrideMaterial = null;
    state.ocean.materialOcean.uniforms.u_vpMatrix.value = ((new THREE.Matrix4()).multiply(state.camera.projectionMatrix)).multiply(state.camera.matrixWorldInverse);
    state.ocean.materialOcean.uniforms.u_vpMatrixInverse.value = ((new THREE.Matrix4()).multiply(state.camera.matrixWorld)).multiply(state.camera.projectionMatrixInverse);
    state.ocean.materialOcean.uniforms.u_cameraNear.value = state.camera.near;
    state.ocean.materialOcean.uniforms.u_cameraFar.value = state.camera.far;
    state.ocean.materialOcean.uniforms.u_cameraPosition.value = state.camera.position;

    state.renderer.setRenderTarget(null);
    state.renderer.render(state.scene, state.camera);
}

function animate(startImageChangeCount) {
    if (state.imageChangeCount > startImageChangeCount) return;
    requestAnimationFrame(() => { animate(startImageChangeCount); });
    if (state.animate_flag) {
        render();
        state.stats.update();
    }
}
/* Renderer */