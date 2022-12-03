/**
 * threejs.org/license
 * @author mrdoob / http://mrdoob.com/
 * @author Mugen87 / https://github.com/Mugen87
 * 
 * Modified by Ryusuke Sugimoto
 */

THREE.ScreenPlaneBufferGeometry = function ( screenWidth, screenHeight, geometrySparsity) {

	THREE.BufferGeometry.call( this );

	this.type = 'ScreenPlaneBufferGeometry';

	var gridX = Math.ceil( screenWidth*1.2 / geometrySparsity ) || 1;
	var gridY = Math.ceil( screenHeight*1.2 / geometrySparsity ) || 1;

	var gridX1 = gridX + 1;
	var gridY1 = gridY + 1;

	var ix, iy;

	// buffers

	var indices = [];
	var vertices = [];

	// generate vertices
	for ( iy = 0; iy < gridY1; iy ++ ) {

		var y = 2.4*iy/gridY - 1.2;

		for ( ix = 0; ix < gridX1; ix ++ ) {

			var x = 2.4*ix/gridX - 1.2;
			vertices.push( x, -y, 0.0 );
		}
	}

	// indices

	for ( iy = 0; iy < gridY; iy ++ ) {

		for ( ix = 0; ix < gridX; ix ++ ) {

			var a = ix + gridX1 * iy;
			var b = ix + gridX1 * ( iy + 1 );
			var c = ( ix + 1 ) + gridX1 * ( iy + 1 );
			var d = ( ix + 1 ) + gridX1 * iy;

			indices.push( a, b, d );
			indices.push( b, c, d );

		}

	}

	// build geometry
	this.setIndex( indices );
	this.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
}
THREE.ScreenPlaneBufferGeometry.prototype = Object.create( THREE.BufferGeometry.prototype );
THREE.ScreenPlaneBufferGeometry.prototype.constructor = THREE.ScreenPlaneBufferGeometry;

THREE.Ocean = function ( renderer, image_size, org_path, tex_path, mask_path, num_imgs, params ) {
	this.oceanColor = Array.isArray(params.OCEAN_COLOR)? new THREE.Vector3(...params.OCEAN_COLOR): params.OCEAN_COLOR;
	this.shConstants = params.SH_CONSTANTS;
	this.wind = params.WIND;
	this.choppiness = params.CHOPPINESS;
	this.size = params.GEOMETRY_SIZE;

	// flag used to trigger parameter changes
	this.changed = true;
	this.initial = true;
	this.viewportChanged = false;
	this.viewportChangeFinished = true;

	// Assign required parameters as object properties
	this.simulationCamera = new THREE.OrthographicCamera();
	this.simulationCamera.position.z = 1;
	this.renderer = renderer;
	renderer.clearColor(50/255, 50/255, 50/255);
	this.simulationScene = new THREE.Scene();
	this.resolution = 1024;
	this.playbackSpeed = 1.0;
	this.matrixNeedsUpdate = false;
	this.num_imgs = num_imgs;

	// Setup framebuffer pipeline
    this.LinearRepeatParams = {
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        format: THREE.RGBAFormat,
        stencilBuffer: false,
        depthBuffer: false,
        premultiplyAlpha: false,
        type: THREE.FloatType
    };
	this.NearestClampParams = {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		wrapS: THREE.ClampToEdgeWrapping,
		wrapT: THREE.ClampToEdgeWrapping,
		format: THREE.RGBAFormat,
		stencilBuffer: false,
		depthBuffer: false,
		premultiplyAlpha: false,
		type: THREE.FloatType
	};
	this.NearestClamp1DParams = {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		wrapS: THREE.ClampToEdgeWrapping,
		wrapT: THREE.ClampToEdgeWrapping,
		format: THREE.REDFormat,
		stencilBuffer: false,
		depthBuffer: false,
		premultiplyAlpha: false,
		type: THREE.FloatType
	};
	this.NearestRepeatParams = {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		wrapS: THREE.RepeatWrapping,
		wrapT: THREE.RepeatWrapping,
		format: THREE.REDFormat,
		stencilBuffer: false,
		depthBuffer: false,
		premultiplyAlpha: false,
		type: THREE.FloatType
	};

	this.initialSpectrumFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.NearestRepeatParams );
	this.spectrumFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.NearestClampParams );
	this.pingPhaseFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.NearestClamp1DParams );
	this.pongPhaseFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.NearestClamp1DParams );
	this.pingTransformFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.NearestClampParams );
	this.pongTransformFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.NearestClampParams );
	this.displacementMapFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.LinearRepeatParams );
	this.normalMapFramebuffer = new THREE.WebGLRenderTarget( this.resolution, this.resolution, this.LinearRepeatParams );
	this.boundaryRayCollisionFramebuffer = new THREE.WebGLRenderTarget( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight, this.NearestClampParams );
	this.filterBoundaryRayCollisionFramebuffer = new THREE.WebGLRenderTarget( this.renderer.domElement.clientWidth*window.devicePixelRatio, this.renderer.domElement.clientHeight*window.devicePixelRatio, this.NearestClampParams );

	this.displacementMapFramebuffer.texture.generateMipmaps = true;
	this.normalMapFramebuffer.texture.generateMipmaps = true;

	// Define shaders and constant uniforms
	////////////////////////////////////////

	// 0 - The vertex shader used in all of the simulation steps
	let fullscreeenVertexShader = THREE.ShaderLib[ "ocean_sim_vertex" ];

	// 1 - Horizontal wave vertices used for FFT
	let oceanHorizontalShader = THREE.ShaderLib[ "ocean_subtransform" ];
	let oceanHorizontalUniforms = THREE.UniformsUtils.clone( oceanHorizontalShader.uniforms );
	this.materialOceanHorizontal = new THREE.ShaderMaterial( {
		uniforms: oceanHorizontalUniforms,
		vertexShader: fullscreeenVertexShader.vertexShader,
		fragmentShader: "#define HORIZONTAL \n" + oceanHorizontalShader.fragmentShader
	} );
	this.materialOceanHorizontal.uniforms.u_transformSize = { value: this.resolution };
	this.materialOceanHorizontal.uniforms.u_subtransformSize = { value: null };
	this.materialOceanHorizontal.uniforms.u_input = { value: null };
	this.materialOceanHorizontal.depthTest = false;

	// 2 - Vertical wave vertices used for FFT
	let oceanVerticalShader = THREE.ShaderLib[ "ocean_subtransform" ];
	let oceanVerticalUniforms = THREE.UniformsUtils.clone( oceanVerticalShader.uniforms );
	this.materialOceanVertical = new THREE.ShaderMaterial( {
		uniforms: oceanVerticalUniforms,
		vertexShader: fullscreeenVertexShader.vertexShader,
		fragmentShader: oceanVerticalShader.fragmentShader
	} );
	this.materialOceanVertical.uniforms.u_transformSize = { value: this.resolution };
	this.materialOceanVertical.uniforms.u_subtransformSize = { value: null };
	this.materialOceanVertical.uniforms.u_input = { value: null };
	this.materialOceanVertical.depthTest = false;

	// 3 - Initial spectrum used to generate height map
	let initialSpectrumShader = THREE.ShaderLib[ "ocean_initial_spectrum" ];
	let initialSpectrumUniforms = THREE.UniformsUtils.clone( initialSpectrumShader.uniforms );
	this.materialInitialSpectrum = new THREE.ShaderMaterial( {
		uniforms: initialSpectrumUniforms,
		vertexShader: fullscreeenVertexShader.vertexShader,
		fragmentShader: initialSpectrumShader.fragmentShader
	} );
	this.materialInitialSpectrum.uniforms.u_wind = { value: new THREE.Vector2() };
	this.materialInitialSpectrum.uniforms.u_resolution = { value: this.resolution };
	this.materialInitialSpectrum.depthTest = false;

	// 4 - Shader used to animate heightmap
	let phaseShader = THREE.ShaderLib[ "ocean_phase" ];
	let phaseUniforms = THREE.UniformsUtils.clone( phaseShader.uniforms );
	this.materialPhase = new THREE.ShaderMaterial( {
		uniforms: phaseUniforms,
		vertexShader: fullscreeenVertexShader.vertexShader,
		fragmentShader: phaseShader.fragmentShader
	} );
	this.materialPhase.uniforms.u_resolution = { value: this.resolution };
	this.materialPhase.depthTest = false;

	// 5 - Shader used to update spectrum
	let spectrumShader = THREE.ShaderLib[ "ocean_spectrum" ];
	let spectrumUniforms = THREE.UniformsUtils.clone( spectrumShader.uniforms );
	this.materialSpectrum = new THREE.ShaderMaterial( {
		uniforms: spectrumUniforms,
		vertexShader: fullscreeenVertexShader.vertexShader,
		fragmentShader: spectrumShader.fragmentShader
	} );
	this.materialSpectrum.uniforms.u_initialSpectrum = { value: this.initialSpectrumFramebuffer.texture};
	this.materialSpectrum.uniforms.u_resolution = { value: this.resolution };
	this.materialSpectrum.depthTest = false;

	// 6 - Shader used to update spectrum normals
	let normalShader = THREE.ShaderLib[ "ocean_normals" ];
	let normalUniforms = THREE.UniformsUtils.clone( normalShader.uniforms );
	this.materialNormal = new THREE.ShaderMaterial( {
		uniforms: normalUniforms,
		vertexShader: fullscreeenVertexShader.vertexShader,
		fragmentShader: normalShader.fragmentShader
	} );
	this.materialNormal.uniforms.u_displacementMap = { value: this.displacementMapFramebuffer.texture };
	this.materialNormal.uniforms.u_resolution = { value: this.resolution };
	this.materialNormal.depthTest = false;

	// 7 - Shader used to compute final pixel intensity
	let oceanShader = THREE.ShaderLib[ "ocean_main" ];
	let oceanUniforms = THREE.UniformsUtils.clone( oceanShader.uniforms );
	this.materialOcean = new THREE.ShaderMaterial( {
		uniforms: oceanUniforms,
		vertexShader: oceanShader.vertexShader,
		fragmentShader: oceanShader.fragmentShader,
		transparent: true,
	} );
	this.materialOcean.uniforms.u_geometrySize = { value: this.size };
	this.materialOcean.uniforms.u_displacementMap = { value: this.displacementMapFramebuffer.texture };
	this.materialOcean.uniforms.u_normalMap = { value: this.normalMapFramebuffer.texture };
	this.materialOcean.uniforms.u_oceanColor = { value: this.oceanColor };
	this.materialOcean.uniforms.u_shConstants = { value: this.shConstants };

    this.maskTexture = new THREE.TextureLoader().load( mask_path ) ;
	this.maskTexture.minFilter = THREE.LinearFilter;
    this.materialOcean.uniforms.u_maskTexture = { value: this.maskTexture };
	this.reflectionTextures = [];
	for (let i=0; i<num_imgs; i++) {
		let reflectionTexture = new THREE.TextureLoader().load( tex_path.format(i+1) ) ;
		reflectionTexture.minFilter = THREE.LinearFilter;
		this.reflectionTextures.push(reflectionTexture);

	}
	this.materialOcean.uniforms.u_reflectionTextures = { type:"tv", value: this.reflectionTextures };
	this.materialOcean.uniforms.u_collisionCoordTexture = { value: this.filterBoundaryRayCollisionFramebuffer.texture };
	this.materialOcean.uniforms.u_screenResolution = { value: new THREE.Vector2( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight ) };
	this.materialOcean.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };
	this.materialOcean.uniforms.u_devicePixelRatio = { value: window.devicePixelRatio };
	this.materialOcean.uniforms.u_texture_interpolation = { value: 0.0 };

	this.materialOcean.depthTest = true;

    // 8 - Shader used to calculate ray collision coordinates for each 4x4 pixels
    let boundaryRayCollisionShader = THREE.ShaderLib[ "ocean_boundaryRayCollision" ];
    let boundaryRayCollisionUniforms = THREE.UniformsUtils.clone( boundaryRayCollisionShader.uniforms );
    this.materialBoundaryRayCollision = new THREE.ShaderMaterial( {
        uniforms: boundaryRayCollisionUniforms,
        vertexShader: fullscreeenVertexShader.vertexShader,
        fragmentShader: "#define COARSE_ITERATION\n"+boundaryRayCollisionShader.fragmentShader
    } );
    this.materialBoundaryRayCollision.depthTest = false;
    this.materialBoundaryRayCollision.uniforms.u_maskTexture = { value: this.maskTexture };
    this.materialBoundaryRayCollision.uniforms.u_screenResolution = { value: new THREE.Vector2( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight ) };
	this.materialBoundaryRayCollision.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };

    this.materialBoundaryRayCollision2 = new THREE.ShaderMaterial( {
        uniforms: boundaryRayCollisionUniforms,
        vertexShader: fullscreeenVertexShader.vertexShader,
        fragmentShader: "#define FINE_ITERATION\n"+boundaryRayCollisionShader.fragmentShader
    } );
    this.materialBoundaryRayCollision2.depthTest = false;
    this.materialBoundaryRayCollision2.uniforms.u_maskTexture = { value: this.maskTexture };
    this.materialBoundaryRayCollision2.uniforms.u_screenResolution = { value: new THREE.Vector2( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight ) };
	this.materialBoundaryRayCollision2.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };

	//9 - Shader 
	let filterBoundaryRayCollisionShader = THREE.ShaderLib[ "ocean_filterBoundaryRayCollision" ];
    let filterBoundaryRayCollisionUniforms = THREE.UniformsUtils.clone( filterBoundaryRayCollisionShader.uniforms );
    this.materialFilterBoundaryRayCollision = new THREE.ShaderMaterial( {
        uniforms: filterBoundaryRayCollisionUniforms,
        vertexShader: filterBoundaryRayCollisionShader.vertexShader,
        fragmentShader: filterBoundaryRayCollisionShader.fragmentShader
    } );
    this.materialFilterBoundaryRayCollision.depthTest = false;
	this.materialFilterBoundaryRayCollision.uniforms.u_maskTexture = { value: this.maskTexture };
	this.materialFilterBoundaryRayCollision.uniforms.u_collisionCoordTexture = { value: this.boundaryRayCollisionFramebuffer.texture };
    this.materialFilterBoundaryRayCollision.uniforms.u_screenResolution = { value: new THREE.Vector2( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight ) };
	this.materialFilterBoundaryRayCollision.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };
	this.materialFilterBoundaryRayCollision.uniforms.u_devicePixelRatio = { value: window.devicePixelRatio };
	this.materialFilterBoundaryRayCollision.uniforms.u_geometrySize = { value: this.size };
	this.materialFilterBoundaryRayCollision.uniforms.u_displacementMap = { value: this.displacementMapFramebuffer.texture };
	this.materialFilterBoundaryRayCollision.uniforms.u_normalMap = { value: this.normalMapFramebuffer.texture };

	//10 - Shader for background texture
	this.backgroundTextureMaterial = new THREE.ShaderMaterial( {
		uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib[ "full_screen_texture" ].uniforms),
		vertexShader: THREE.ShaderLib[ "full_screen_texture" ].vertexShader,
		fragmentShader: THREE.ShaderLib[ "full_screen_texture" ].fragmentShader
	} );
	this.backgroundTextures = [];
	for (let i=0; i<num_imgs; i++) {
		let backgroundTexture = new THREE.TextureLoader().load( org_path.format(i+1) ) ;
		backgroundTexture.minFilter = THREE.LinearFilter;
		this.backgroundTextures.push(backgroundTexture);
	}
	this.backgroundTextureMaterial.uniforms.u_textures = { type:"tv", value: this.backgroundTextures };
	this.backgroundTextureMaterial.uniforms.u_screenResolution = { value: new THREE.Vector2( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight ) };
	this.backgroundTextureMaterial.uniforms.u_centerShift= { value: null };
	this.backgroundTextureMaterial.uniforms.u_zoomFactor = { value: null };
	this.backgroundTextureMaterial.uniforms.u_imageSize =  { value: new THREE.Vector2( image_size.x, image_size.y )};
	this.backgroundTextureMaterial.uniforms.u_devicePixelRatio = { value: window.devicePixelRatio };
	this.backgroundTextureMaterial.uniforms.u_texture_interpolation = { value: 0.0 };
	this.backgroundTextureMaterial.depthTest = false;
	this.backgroundTextureMesh = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), this.backgroundTextureMaterial );
	this.backgroundTextureMesh.frustumCulled = false;

	// Disable blending to prevent default premultiplied alpha values
	this.materialOceanHorizontal.blending = 0;
	this.materialOceanVertical.blending = 0;
	this.materialInitialSpectrum.blending = 0;
	this.materialPhase.blending = 0;
	this.materialSpectrum.blending = 0;
	this.materialNormal.blending = 0;
	this.materialBoundaryRayCollision.blending = 0;
    this.materialBoundaryRayCollision2.blending = 0;
	this.materialFilterBoundaryRayCollision.blending = 0;

	// Create the simulation plane
	this.screenQuad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ) );
	this.simulationScene.add( this.screenQuad );

	// Initialize spectrum data
	this.generateSeedPhaseTexture();

	// Generate the ocean mesh
	this.generateMesh();
};

THREE.Ocean.prototype.updateImage = function(image_size, org_path, tex_path, mask_path, num_imgs) {
	this.num_imgs = num_imgs;
	const MAX_TEXTURE_NUM = 8;

	this.materialOcean.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };
	this.materialBoundaryRayCollision.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };
	this.materialBoundaryRayCollision2.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };
	this.materialFilterBoundaryRayCollision.uniforms.u_imageSize = { value: new THREE.Vector2( image_size.x, image_size.y ) };

	if(typeof this.reflectionTextures !="undefined") {
		for (let i=0; i<this.reflectionTextures.length; i++)
			this.reflectionTextures[i].dispose();
	}
	this.reflectionTextures = [];
	for (let i=0; i<num_imgs; i++) {
		let reflectionTexture = new THREE.TextureLoader().load( tex_path.format(i+1) ) ;
		reflectionTexture.minFilter = THREE.LinearFilter;
		this.reflectionTextures.push(reflectionTexture);
	}
	for (let i=num_imgs; i<MAX_TEXTURE_NUM; i++)
		this.reflectionTextures.push(this.reflectionTextures[this.reflectionTextures.length-1]);
	this.materialOcean.uniforms.u_reflectionTextures = { type:"tv", value: this.reflectionTextures };

	if(typeof this.maskTexture !="undefined") this.maskTexture.dispose();
	this.maskTexture = new THREE.TextureLoader().load( mask_path ) ;
	this.maskTexture.minFilter = THREE.LinearFilter;
	this.materialOcean.uniforms.u_maskTexture = { value: this.maskTexture };
	this.materialBoundaryRayCollision.uniforms.u_maskTexture = { value: this.maskTexture };
	this.materialBoundaryRayCollision2.uniforms.u_maskTexture = { value: this.maskTexture };
	this.materialFilterBoundaryRayCollision.uniforms.u_maskTexture = { value: this.maskTexture };

	if(typeof this.backgroundTextures !="undefined") {
		for (let i=0; i<this.backgroundTextures.length; i++)
			this.backgroundTextures[i].dispose();
	}
	this.backgroundTextures = [];
	for (let i=0; i<num_imgs; i++) {
		let backgroundTexture = new THREE.TextureLoader().load( org_path.format(i+1) ) ;
		backgroundTexture.minFilter = THREE.LinearFilter;
		this.backgroundTextures.push(backgroundTexture);
	}
	for (let i=num_imgs; i<MAX_TEXTURE_NUM; i++)
		this.backgroundTextures.push(this.backgroundTextures[this.backgroundTextures.length-1]);
	this.backgroundTextureMaterial.uniforms.u_textures = { type:"tv", value: this.backgroundTextures };
	this.backgroundTextureMaterial.uniforms.u_imageSize =  { value: new THREE.Vector2( image_size.x, image_size.y )};
}

THREE.Ocean.prototype.generateMesh = function () {
	if(typeof this.oceanMesh !="undefined"){
		this.oceanMesh.geometry.dispose();
	}
	let geometry = new THREE.ScreenPlaneBufferGeometry( this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight, 8 );
	this.oceanMesh = new THREE.Mesh( geometry, this.materialOcean );
    this.oceanMesh.frustumCulled = false;
};

THREE.Ocean.prototype.onWindowResize = function () {
	const width = this.renderer.domElement.clientWidth;
	const height = this.renderer.domElement.clientHeight;
	if(typeof this.boundaryRayCollisionFramebuffer !="undefined") this.boundaryRayCollisionFramebuffer.dispose();
	this.boundaryRayCollisionFramebuffer = new THREE.WebGLRenderTarget( width, height, this.NearestClampParams );
	this.materialFilterBoundaryRayCollision.uniforms.u_collisionCoordTexture = { value: this.boundaryRayCollisionFramebuffer.texture };
	if(typeof this.filterBoundaryRayCollisionFramebuffer!="undefined") this.filterBoundaryRayCollisionFramebuffer.dispose();
	this.filterBoundaryRayCollisionFramebuffer = new THREE.WebGLRenderTarget( width*window.devicePixelRatio, height*window.devicePixelRatio, this.NearestClampParams );
	this.materialOcean.uniforms.u_collisionCoordTexture = { value: this.filterBoundaryRayCollisionFramebuffer.texture };
	this.materialOcean.uniforms.u_screenResolution = { value: new THREE.Vector2( width, height ) };
	this.materialFilterBoundaryRayCollision.uniforms.u_screenResolution = { value: new THREE.Vector2( width, height ) };
	this.materialBoundaryRayCollision.uniforms.u_screenResolution = { value: new THREE.Vector2( width, height ) };
	this.materialBoundaryRayCollision2.uniforms.u_screenResolution = { value: new THREE.Vector2( width, height ) };
	this.generateMesh();
	this.backgroundTextureMaterial.uniforms.u_screenResolution = { value: new THREE.Vector2( width, height ) };
};

THREE.Ocean.prototype.onViewportChange = function (zoom, centerShift) {
	this.viewportChanged = true;

	if(typeof this.maskCalTimer=='undefined') this.maskCalTimer = 0;
    if(this.maskCalTimer>0) clearTimeout(this.maskCalTimer);
    this.maskCalTimer = setTimeout(()=>{this.viewportChangeFinished = true;},200);

	this.materialBoundaryRayCollision.uniforms.u_centerShift.value = centerShift;
    this.materialBoundaryRayCollision2.uniforms.u_centerShift.value = centerShift;
    this.materialOcean.uniforms.u_centerShift.value = centerShift;
    this.materialFilterBoundaryRayCollision.uniforms.u_centerShift.value = centerShift;
    this.backgroundTextureMaterial.uniforms.u_centerShift.value = centerShift;
    this.materialBoundaryRayCollision.uniforms.u_zoomFactor.value = zoom;
    this.materialBoundaryRayCollision2.uniforms.u_zoomFactor.value = zoom;
    this.materialOcean.uniforms.u_zoomFactor.value = zoom;
    this.materialFilterBoundaryRayCollision.uniforms.u_zoomFactor.value = zoom;
	this.backgroundTextureMaterial.uniforms.u_zoomFactor.value = zoom;
}

THREE.Ocean.prototype.render = function () {
	this.simulationScene.overrideMaterial = null;

	if( this.viewportChangeFinished ){
        this.renderBoundaryRayCollision2();
        this.viewportChangeFinished = false;
        this.viewportChanged = false;
	} else if ( this.viewportChanged) {
        this.renderBoundaryRayCollision();
        this.viewportChanged = false;
    }

	if ( this.changed )
		this.renderInitialSpectrum();

	this.renderWavePhase();
	this.renderSpectrum();
	this.renderSpectrumFFT();
	this.renderNormalMap();
	this.simulationScene.overrideMaterial = null;

};

THREE.Ocean.prototype.generateSeedPhaseTexture = function() {
	this.pingPhase = true;
	let phaseArray = new window.Float32Array( this.resolution * this.resolution * 4 );
	for ( let i = 0; i < this.resolution; i ++ ) {
		for ( let j = 0; j < this.resolution; j ++ ) {
			phaseArray[ i * this.resolution * 4 + j * 4 ] =  Math.random() * 2.0 * Math.PI;
			phaseArray[ i * this.resolution * 4 + j * 4 + 1 ] = 0.0;
			phaseArray[ i * this.resolution * 4 + j * 4 + 2 ] = 0.0;
			phaseArray[ i * this.resolution * 4 + j * 4 + 3 ] = 0.0;
		}
	}

	this.pingPhaseTexture = new THREE.DataTexture( phaseArray, this.resolution, this.resolution, THREE.RGBAFormat );
	this.pingPhaseTexture.wrapS = THREE.ClampToEdgeWrapping;
	this.pingPhaseTexture.wrapT = THREE.ClampToEdgeWrapping;
	this.pingPhaseTexture.type = THREE.FloatType;
	this.pingPhaseTexture.needsUpdate = true;
};

THREE.Ocean.prototype.renderInitialSpectrum = function () {
	this.simulationScene.overrideMaterial = this.materialInitialSpectrum;
	this.materialInitialSpectrum.uniforms.u_wind.value.set( ...this.wind );
	this.materialInitialSpectrum.uniforms.u_size.value = this.size;
	this.renderer.setRenderTarget( this.initialSpectrumFramebuffer );
	this.renderer.clear();
	this.renderer.render( this.simulationScene, this.simulationCamera );
};

THREE.Ocean.prototype.renderWavePhase = function () {
	this.simulationScene.overrideMaterial = this.materialPhase;
	this.screenQuad.material = this.materialPhase;
	if(this.initial) this.materialPhase.uniforms.u_phases.value = this.pingPhaseTexture;
	else this.materialPhase.uniforms.u_phases.value = this.pingPhase ? this.pingPhaseFramebuffer.texture : this.pongPhaseFramebuffer.texture;
	this.materialPhase.uniforms.u_deltaTime.value = this.playbackSpeed*this.deltaTime;
	this.materialPhase.uniforms.u_size.value = this.size;
	this.renderer.setRenderTarget( this.pingPhase ? this.pongPhaseFramebuffer : this.pingPhaseFramebuffer );
	this.renderer.render( this.simulationScene, this.simulationCamera );
	this.pingPhase = ! this.pingPhase;
	if(this.initial){
		this.pingPhaseTexture.dispose();
		this.initial = false;
	}
};

THREE.Ocean.prototype.renderSpectrum = function () {
	this.simulationScene.overrideMaterial = this.materialSpectrum;
	this.materialSpectrum.uniforms.u_phases.value = this.pingPhase ? this.pingPhaseFramebuffer.texture : this.pongPhaseFramebuffer.texture;
	this.materialSpectrum.uniforms.u_choppiness.value = this.choppiness;
	this.materialSpectrum.uniforms.u_size.value = this.size;
	this.renderer.setRenderTarget( this.spectrumFramebuffer );
	this.renderer.render( this.simulationScene, this.simulationCamera );
};

THREE.Ocean.prototype.renderSpectrumFFT = function() {
	// GPU FFT using Stockham formulation
	let iterations = Math.log( this.resolution ) / Math.log( 2 ); // log2
	this.simulationScene.overrideMaterial = this.materialOceanHorizontal;
	for ( let i = 0; i < iterations; i ++ ) {
		if ( i === 0 ) {
			this.materialOceanHorizontal.uniforms.u_input.value = this.spectrumFramebuffer.texture;
			this.materialOceanHorizontal.uniforms.u_subtransformSize.value = Math.pow( 2, ( i % ( iterations ) ) + 1 );
			this.renderer.setRenderTarget( this.pingTransformFramebuffer );
			this.renderer.render( this.simulationScene, this.simulationCamera );
		} else if ( i % 2 === 1 ) {
			this.materialOceanHorizontal.uniforms.u_input.value = this.pingTransformFramebuffer.texture;
			this.materialOceanHorizontal.uniforms.u_subtransformSize.value = Math.pow( 2, ( i % ( iterations ) ) + 1 );
			this.renderer.setRenderTarget( this.pongTransformFramebuffer );
			this.renderer.render( this.simulationScene, this.simulationCamera );
		} else {
			this.materialOceanHorizontal.uniforms.u_input.value = this.pongTransformFramebuffer.texture;
			this.materialOceanHorizontal.uniforms.u_subtransformSize.value = Math.pow( 2, ( i % ( iterations ) ) + 1 );
			this.renderer.setRenderTarget( this.pingTransformFramebuffer );
			this.renderer.render( this.simulationScene, this.simulationCamera );
		}
	}
	this.simulationScene.overrideMaterial = this.materialOceanVertical;
	for ( let i = iterations; i < iterations * 2; i ++ ) {
		if ( i === iterations * 2 - 1 ) {
			this.materialOceanVertical.uniforms.u_input.value = ( iterations % 2 === 0 ) ? this.pingTransformFramebuffer.texture : this.pongTransformFramebuffer.texture;
			this.materialOceanVertical.uniforms.u_subtransformSize.value = Math.pow( 2, ( i % ( iterations ) ) + 1 );
			this.renderer.setRenderTarget( this.displacementMapFramebuffer );
			this.renderer.render( this.simulationScene, this.simulationCamera );
		} else if ( i % 2 === 1 ) {
			this.materialOceanVertical.uniforms.u_input.value = this.pingTransformFramebuffer.texture;
			this.materialOceanVertical.uniforms.u_subtransformSize.value = Math.pow( 2, ( i % ( iterations ) ) + 1 );
			this.renderer.setRenderTarget( this.pongTransformFramebuffer );
			this.renderer.render( this.simulationScene, this.simulationCamera );
		} else {
			this.materialOceanVertical.uniforms.u_input.value = this.pongTransformFramebuffer.texture;
			this.materialOceanVertical.uniforms.u_subtransformSize.value = Math.pow( 2, ( i % ( iterations ) ) + 1 );
			this.renderer.setRenderTarget( this.pingTransformFramebuffer );
			this.renderer.render( this.simulationScene, this.simulationCamera );
		}
	}
};

THREE.Ocean.prototype.renderNormalMap = function () {
	this.simulationScene.overrideMaterial = this.materialNormal;
	this.materialNormal.uniforms.u_size.value = this.size;
	this.renderer.setRenderTarget( this.normalMapFramebuffer );
	this.renderer.render( this.simulationScene, this.simulationCamera );
};

THREE.Ocean.prototype.renderBoundaryRayCollision = function(){
    this.simulationScene.overrideMaterial = this.materialBoundaryRayCollision;
    this.materialBoundaryRayCollision.uniforms.u_maskTexture.value = this.maskTexture;
    this.renderer.setRenderTarget( this.boundaryRayCollisionFramebuffer );
	this.renderer.render( this.simulationScene, this.simulationCamera );
};

THREE.Ocean.prototype.renderBoundaryRayCollision2 = function(){
    this.simulationScene.overrideMaterial = this.materialBoundaryRayCollision2;
	this.materialBoundaryRayCollision2.uniforms.u_maskTexture.value = this.maskTexture;
	this.renderer.setRenderTarget( this.boundaryRayCollisionFramebuffer );
	this.renderer.render( this.simulationScene, this.simulationCamera );
};