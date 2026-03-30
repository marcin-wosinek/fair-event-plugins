<?php
/**
 * Photo Upload Template
 *
 * Standalone page for participants to upload photos via token authentication.
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in templates are scoped and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Services\ParticipantToken;
use FairAudience\Database\ParticipantRepository;

// Get the token from the query var.
$token = sanitize_text_field( get_query_var( 'participant_token' ) );

// Process the request.
$result = array(
	'success'       => false,
	'message'       => '',
	'participant'   => null,
	'token'         => $token,
	'event_date_id' => 0,
);

// Verify token.
$token_data = ParticipantToken::verify( $token );

if ( false === $token_data ) {
	$result['message'] = __( 'Invalid or expired link. Please use the link from your email.', 'fair-audience' );
} else {
	$participant_repository = new ParticipantRepository();
	$participant            = $participant_repository->get_by_id( $token_data['participant_id'] );

	if ( ! $participant ) {
		$result['message'] = __( 'Participant not found.', 'fair-audience' );
	} else {
		$result['success']       = true;
		$result['participant']   = $participant;
		$result['event_date_id'] = $token_data['event_date_id'];
	}
}

$site_name_header = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
$rest_url         = esc_url( rest_url( 'fair-audience/v1/photo-upload' ) );
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html( $site_name_header ); ?> &mdash; <?php esc_html_e( 'Upload Photos', 'fair-audience' ); ?></title>
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

<style>
	.fair-audience-photo-upload-container {
		max-width: 700px;
		margin: 60px auto;
		padding: 40px 20px;
	}

	.fair-audience-photo-upload-box {
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		padding: 40px;
	}

	.fair-audience-photo-upload-title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 8px;
		color: #1e1e1e;
		text-align: center;
	}

	.fair-audience-photo-upload-subtitle {
		font-size: 14px;
		color: #757575;
		margin-bottom: 24px;
		text-align: center;
	}

	.fair-audience-photo-upload-message {
		padding: 12px 16px;
		border-radius: 4px;
		margin-bottom: 24px;
		font-size: 14px;
	}

	.fair-audience-photo-upload-message.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.fair-audience-photo-upload-message.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.fair-audience-drop-zone {
		border: 2px dashed #c0c0c0;
		border-radius: 8px;
		padding: 40px 20px;
		text-align: center;
		cursor: pointer;
		transition: border-color 0.2s, background-color 0.2s;
		margin-bottom: 16px;
	}

	.fair-audience-drop-zone:hover,
	.fair-audience-drop-zone.dragover {
		border-color: #0073aa;
		background-color: #f0f7fc;
	}

	.fair-audience-drop-zone-icon {
		font-size: 48px;
		color: #999;
		margin-bottom: 12px;
	}

	.fair-audience-drop-zone-text {
		font-size: 16px;
		color: #555;
		margin-bottom: 8px;
	}

	.fair-audience-drop-zone-hint {
		font-size: 13px;
		color: #999;
	}

	.fair-audience-preview-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 12px;
		margin-bottom: 24px;
	}

	.fair-audience-preview-item {
		position: relative;
		aspect-ratio: 1;
		border-radius: 6px;
		overflow: hidden;
		background: #f0f0f0;
	}

	.fair-audience-preview-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.fair-audience-preview-remove {
		position: absolute;
		top: 4px;
		right: 4px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		border: none;
		border-radius: 50%;
		width: 24px;
		height: 24px;
		font-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.fair-audience-preview-remove:hover {
		background: rgba(200, 0, 0, 0.8);
	}

	.fair-audience-upload-button {
		display: block;
		width: 100%;
		background-color: #0073aa;
		color: #fff;
		border: none;
		padding: 14px 24px;
		border-radius: 4px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.fair-audience-upload-button:hover {
		background-color: #005a87;
	}

	.fair-audience-upload-button:disabled {
		background-color: #ccc;
		cursor: not-allowed;
	}

	.fair-audience-photo-upload-footer {
		margin-top: 24px;
		text-align: center;
	}

	.fair-audience-photo-upload-link {
		color: #0073aa;
		text-decoration: none;
	}

	.fair-audience-photo-upload-link:hover {
		text-decoration: underline;
	}

	.fair-audience-error-container {
		text-align: center;
	}

	.fair-audience-error-icon {
		font-size: 48px;
		color: #d63638;
		margin-bottom: 20px;
	}

	.fair-audience-progress-bar {
		width: 100%;
		height: 6px;
		background: #e0e0e0;
		border-radius: 3px;
		margin-bottom: 16px;
		overflow: hidden;
		display: none;
	}

	.fair-audience-progress-bar-fill {
		height: 100%;
		background: #0073aa;
		border-radius: 3px;
		transition: width 0.3s;
		width: 0%;
	}
</style>

<div class="fair-audience-photo-upload-container">
	<div class="fair-audience-photo-upload-box">
		<?php if ( ! $result['success'] ) : ?>
			<div class="fair-audience-error-container">
				<div class="fair-audience-error-icon">&#10007;</div>
				<h1 class="fair-audience-photo-upload-title">
					<?php echo esc_html__( 'Invalid Link', 'fair-audience' ); ?>
				</h1>
				<p class="fair-audience-photo-upload-message error">
					<?php echo esc_html( $result['message'] ); ?>
				</p>
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-photo-upload-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>
		<?php else : ?>
			<h1 class="fair-audience-photo-upload-title">
				<?php echo esc_html__( 'Upload Photos', 'fair-audience' ); ?>
			</h1>
			<p class="fair-audience-photo-upload-subtitle">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %s: participant name */
						__( 'Hi %s! Share your photos from the event.', 'fair-audience' ),
						$result['participant']->name
					)
				);
				?>
			</p>

			<div id="photo-upload-message" class="fair-audience-photo-upload-message" style="display: none;"></div>

			<div id="drop-zone" class="fair-audience-drop-zone">
				<div class="fair-audience-drop-zone-icon">&#128247;</div>
				<div class="fair-audience-drop-zone-text">
					<?php echo esc_html__( 'Drag & drop photos here or click to browse', 'fair-audience' ); ?>
				</div>
				<div class="fair-audience-drop-zone-hint">
					<?php echo esc_html__( 'JPEG, PNG, GIF, or WebP. Max 20 MB per file.', 'fair-audience' ); ?>
				</div>
				<input type="file" id="file-input" multiple accept="image/jpeg,image/png,image/gif,image/webp" style="display: none;">
			</div>

			<div id="preview-grid" class="fair-audience-preview-grid"></div>

			<div id="progress-bar" class="fair-audience-progress-bar">
				<div id="progress-bar-fill" class="fair-audience-progress-bar-fill"></div>
			</div>

			<button type="button" id="upload-button" class="fair-audience-upload-button" disabled>
				<?php echo esc_html__( 'Upload Photos', 'fair-audience' ); ?>
			</button>

			<div class="fair-audience-photo-upload-footer">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-photo-upload-link">
					<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
				</a>
			</div>

			<script>
				(function() {
					'use strict';

					var restUrl = <?php echo wp_json_encode( $rest_url ); ?>;
					var token = <?php echo wp_json_encode( $result['token'] ); ?>;

					var dropZone = document.getElementById('drop-zone');
					var fileInput = document.getElementById('file-input');
					var previewGrid = document.getElementById('preview-grid');
					var uploadButton = document.getElementById('upload-button');
					var progressBar = document.getElementById('progress-bar');
					var progressFill = document.getElementById('progress-bar-fill');
					var messageDiv = document.getElementById('photo-upload-message');

					var selectedFiles = [];

					// Click to browse.
					dropZone.addEventListener('click', function() {
						fileInput.click();
					});

					// File input change.
					fileInput.addEventListener('change', function() {
						addFiles(fileInput.files);
						fileInput.value = '';
					});

					// Drag and drop.
					dropZone.addEventListener('dragover', function(e) {
						e.preventDefault();
						dropZone.classList.add('dragover');
					});

					dropZone.addEventListener('dragleave', function() {
						dropZone.classList.remove('dragover');
					});

					dropZone.addEventListener('drop', function(e) {
						e.preventDefault();
						dropZone.classList.remove('dragover');
						addFiles(e.dataTransfer.files);
					});

					function addFiles(fileList) {
						for (var i = 0; i < fileList.length; i++) {
							var file = fileList[i];
							if (!file.type.match(/^image\/(jpeg|png|gif|webp)$/)) {
								continue;
							}
							if (file.size > 20 * 1024 * 1024) {
								continue;
							}
							selectedFiles.push(file);
						}
						renderPreviews();
						updateButton();
					}

					function removeFile(index) {
						selectedFiles.splice(index, 1);
						renderPreviews();
						updateButton();
					}

					function renderPreviews() {
						previewGrid.innerHTML = '';
						selectedFiles.forEach(function(file, index) {
							var item = document.createElement('div');
							item.className = 'fair-audience-preview-item';

							var img = document.createElement('img');
							img.src = URL.createObjectURL(file);
							item.appendChild(img);

							var removeBtn = document.createElement('button');
							removeBtn.className = 'fair-audience-preview-remove';
							removeBtn.type = 'button';
							removeBtn.textContent = '\u00d7';
							removeBtn.addEventListener('click', function(e) {
								e.stopPropagation();
								removeFile(index);
							});
							item.appendChild(removeBtn);

							previewGrid.appendChild(item);
						});
					}

					function updateButton() {
						uploadButton.disabled = selectedFiles.length === 0;
						uploadButton.textContent = selectedFiles.length > 0
							? <?php echo wp_json_encode( __( 'Upload Photos', 'fair-audience' ) ); ?> + ' (' + selectedFiles.length + ')'
							: <?php echo wp_json_encode( __( 'Upload Photos', 'fair-audience' ) ); ?>;
					}

					function showMessage(text, type) {
						messageDiv.textContent = text;
						messageDiv.className = 'fair-audience-photo-upload-message ' + type;
						messageDiv.style.display = 'block';
					}

					uploadButton.addEventListener('click', function() {
						if (selectedFiles.length === 0) {
							return;
						}

						uploadButton.disabled = true;
						uploadButton.textContent = <?php echo wp_json_encode( __( 'Uploading...', 'fair-audience' ) ); ?>;
						progressBar.style.display = 'block';
						progressFill.style.width = '0%';
						messageDiv.style.display = 'none';

						var formData = new FormData();
						formData.append('participant_token', token);
						selectedFiles.forEach(function(file, i) {
							formData.append('photos[' + i + ']', file);
						});

						var xhr = new XMLHttpRequest();

						xhr.upload.addEventListener('progress', function(e) {
							if (e.lengthComputable) {
								var percent = Math.round((e.loaded / e.total) * 100);
								progressFill.style.width = percent + '%';
							}
						});

						xhr.addEventListener('load', function() {
							progressBar.style.display = 'none';
							if (xhr.status >= 200 && xhr.status < 300) {
								var data = JSON.parse(xhr.responseText);
								showMessage(
									<?php echo wp_json_encode( __( 'Photos uploaded successfully!', 'fair-audience' ) ); ?> +
									' (' + data.uploaded_count + ')',
									'success'
								);
								selectedFiles = [];
								renderPreviews();
								updateButton();
							} else {
								var error;
								try {
									error = JSON.parse(xhr.responseText);
								} catch (e) {
									error = {};
								}
								showMessage(
									error.message || <?php echo wp_json_encode( __( 'Upload failed. Please try again.', 'fair-audience' ) ); ?>,
									'error'
								);
								uploadButton.disabled = false;
								updateButton();
							}
						});

						xhr.addEventListener('error', function() {
							progressBar.style.display = 'none';
							showMessage(
								<?php echo wp_json_encode( __( 'Upload failed. Please check your connection and try again.', 'fair-audience' ) ); ?>,
								'error'
							);
							uploadButton.disabled = false;
							updateButton();
						});

						xhr.open('POST', restUrl);
						xhr.send(formData);
					});
				})();
			</script>
		<?php endif; ?>
	</div>
</div>

<?php wp_footer(); ?>
</body>
</html>
