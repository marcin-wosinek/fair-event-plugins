<?php
/**
 * Image Templates REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for image templates.
 */
class ImageTemplatesController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'image-templates';

	/**
	 * Meta key for marking attachments as image templates.
	 *
	 * @var string
	 */
	const META_KEY = '_fair_audience_image_template';

	/**
	 * Meta key for storing parsed text variables.
	 *
	 * @var string
	 */
	const VARIABLES_META_KEY = '_fair_audience_template_variables';

	/**
	 * Meta key for storing parsed image placeholders.
	 *
	 * @var string
	 */
	const IMAGES_META_KEY = '_fair_audience_template_images';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'attachment_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)/render',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'render_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'id'        => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'variables' => array(
							'type'     => 'object',
							'required' => false,
							'default'  => array(),
						),
						'images'    => array(
							'type'     => 'object',
							'required' => false,
							'default'  => array(),
						),
					),
				),
			)
		);
	}

	/**
	 * Check if user has admin permissions.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user can manage options.
	 */
	public function admin_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * List all image templates.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$args = array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => -1,
			'meta_query'     => array(
				array(
					'key'   => self::META_KEY,
					'value' => '1',
				),
			),
			'orderby'        => 'date',
			'order'          => 'DESC',
		);

		$query     = new \WP_Query( $args );
		$templates = array();

		foreach ( $query->posts as $post ) {
			$templates[] = $this->prepare_template( $post );
		}

		return new WP_REST_Response( $templates, 200 );
	}

	/**
	 * Register an attachment as a template.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response or error.
	 */
	public function create_item( $request ) {
		$attachment_id = $request->get_param( 'attachment_id' );

		$attachment = get_post( $attachment_id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return new WP_Error(
				'invalid_attachment',
				__( 'Invalid attachment ID.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$mime_type = get_post_mime_type( $attachment_id );
		if ( 'image/svg+xml' !== $mime_type ) {
			return new WP_Error(
				'invalid_mime_type',
				__( 'Only SVG files can be used as image templates.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$file_path   = get_attached_file( $attachment_id );
		$svg_content = file_get_contents( $file_path );
		if ( false === $svg_content ) {
			return new WP_Error(
				'file_read_error',
				__( 'Could not read SVG file.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Parse placeholders.
		$variables = $this->parse_text_placeholders( $svg_content );
		$images    = $this->parse_image_placeholders( $svg_content );

		// Store meta.
		update_post_meta( $attachment_id, self::META_KEY, '1' );
		update_post_meta( $attachment_id, self::VARIABLES_META_KEY, $variables );
		update_post_meta( $attachment_id, self::IMAGES_META_KEY, $images );

		$template = $this->prepare_template( $attachment );

		return new WP_REST_Response( $template, 201 );
	}

	/**
	 * Remove template meta from attachment.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response or error.
	 */
	public function delete_item( $request ) {
		$id = $request->get_param( 'id' );

		$attachment = get_post( $id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return new WP_Error(
				'not_found',
				__( 'Template not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		delete_post_meta( $id, self::META_KEY );
		delete_post_meta( $id, self::VARIABLES_META_KEY );
		delete_post_meta( $id, self::IMAGES_META_KEY );

		return new WP_REST_Response( array( 'deleted' => true ), 200 );
	}

	/**
	 * Render a template with provided variables and images.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response or error.
	 */
	public function render_item( $request ) {
		$id        = $request->get_param( 'id' );
		$variables = $request->get_param( 'variables' );
		$images    = $request->get_param( 'images' );

		$attachment = get_post( $id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return new WP_Error(
				'not_found',
				__( 'Template not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$meta = get_post_meta( $id, self::META_KEY, true );
		if ( '1' !== $meta ) {
			return new WP_Error(
				'not_template',
				__( 'Attachment is not registered as a template.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$file_path   = get_attached_file( $id );
		$svg_content = file_get_contents( $file_path );
		if ( false === $svg_content ) {
			return new WP_Error(
				'file_read_error',
				__( 'Could not read SVG file.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Replace image placeholders with base64 data URIs first.
		// Handles both {{name}} and {{image:name}} syntax.
		// Accepts either plain attachment ID or object with id + crop params.
		if ( is_array( $images ) ) {
			foreach ( $images as $name => $value ) {
				$attachment_id = null;
				$crop_params   = null;

				if ( is_array( $value ) && isset( $value['id'] ) ) {
					$attachment_id = absint( $value['id'] );
					if ( isset( $value['crop_x'], $value['crop_y'], $value['crop_width'], $value['crop_height'] ) ) {
						$crop_params = array(
							'x'      => (int) $value['crop_x'],
							'y'      => (int) $value['crop_y'],
							'width'  => (int) $value['crop_width'],
							'height' => (int) $value['crop_height'],
						);
					}
				} else {
					$attachment_id = absint( $value );
				}

				if ( ! $attachment_id ) {
					continue;
				}

				$data_uri = $this->attachment_to_data_uri( $attachment_id, $crop_params );
				if ( ! $data_uri ) {
					continue;
				}

				// Replace both {{name}} and {{image:name}} patterns.
				$svg_content = str_replace( '{{' . $name . '}}', $data_uri, $svg_content );
				$svg_content = str_replace( '{{image:' . $name . '}}', $data_uri, $svg_content );
			}
		}

		// Replace remaining text placeholders with XML-escaped values.
		if ( is_array( $variables ) ) {
			foreach ( $variables as $name => $value ) {
				$escaped_value = htmlspecialchars( $value, ENT_XML1, 'UTF-8' );
				$svg_content   = str_replace( '{{' . $name . '}}', $escaped_value, $svg_content );
			}
		}

		return new WP_REST_Response( array( 'svg' => $svg_content ), 200 );
	}

	/**
	 * Convert an attachment to a base64 data URI, optionally cropping first.
	 *
	 * @param int        $attachment_id Attachment ID.
	 * @param array|null $crop_params   Optional crop params {x, y, width, height} in pixels.
	 * @return string|false Data URI string or false on failure.
	 */
	private function attachment_to_data_uri( $attachment_id, $crop_params = null ) {
		$image_path = get_attached_file( $attachment_id );
		if ( ! $image_path || ! file_exists( $image_path ) ) {
			return false;
		}

		if ( $crop_params ) {
			return $this->crop_and_encode( $image_path, $crop_params );
		}

		$image_data = file_get_contents( $image_path );
		if ( false === $image_data ) {
			return false;
		}

		$mime_type = get_post_mime_type( $attachment_id );
		return 'data:' . $mime_type . ';base64,' . base64_encode( $image_data );
	}

	/**
	 * Crop an image file and return as base64 data URI.
	 *
	 * @param string $image_path  Path to the image file.
	 * @param array  $crop_params Crop params {x, y, width, height} in pixels.
	 * @return string|false Data URI string or false on failure.
	 */
	private function crop_and_encode( $image_path, $crop_params ) {
		$editor = \wp_get_image_editor( $image_path );
		if ( \is_wp_error( $editor ) ) {
			return false;
		}

		$result = $editor->crop(
			$crop_params['x'],
			$crop_params['y'],
			$crop_params['width'],
			$crop_params['height']
		);
		if ( \is_wp_error( $result ) ) {
			return false;
		}

		// Save to a temporary file.
		$temp_file = tempnam( sys_get_temp_dir(), 'fair_crop_' );
		$saved     = $editor->save( $temp_file );
		if ( \is_wp_error( $saved ) ) {
			unlink( $temp_file );
			return false;
		}

		$saved_path = $saved['path'];
		$image_data = file_get_contents( $saved_path );
		$mime_type  = $saved['mime-type'];

		// Clean up temp file.
		unlink( $saved_path );
		if ( $saved_path !== $temp_file && file_exists( $temp_file ) ) {
			unlink( $temp_file );
		}

		if ( false === $image_data ) {
			return false;
		}

		return 'data:' . $mime_type . ';base64,' . base64_encode( $image_data );
	}

	/**
	 * Parse text placeholders from SVG content.
	 * Excludes placeholders that appear inside href/xlink:href attributes of <image> elements.
	 *
	 * @param string $svg_content SVG content.
	 * @return array Array of variable names.
	 */
	private function parse_text_placeholders( $svg_content ) {
		$all_placeholders = $this->parse_all_placeholders( $svg_content );
		$image_objects    = $this->parse_image_placeholders( $svg_content );
		$image_names      = array_map(
			function ( $img ) {
				return $img['name'];
			},
			$image_objects
		);

		$variables = array_diff( $all_placeholders, $image_names );
		return array_values( $variables );
	}

	/**
	 * Parse image placeholders from SVG content.
	 * Detects {{name}} inside href/xlink:href attributes of <image> elements,
	 * and also supports explicit {{image:name}} syntax.
	 *
	 * @param string $svg_content SVG content.
	 * @return array Array of image placeholder names.
	 */
	private function parse_image_placeholders( $svg_content ) {
		$images     = array();
		$seen_names = array();

		// Explicit {{image:name}} syntax (no dimension info available).
		if ( preg_match_all( '/\{\{image:([a-zA-Z_]\w*)\}\}/', $svg_content, $matches ) ) {
			foreach ( $matches[1] as $name ) {
				if ( ! isset( $seen_names[ $name ] ) ) {
					$seen_names[ $name ] = true;
					$images[]            = array( 'name' => $name );
				}
			}
		}

		// Auto-detect: {{name}} inside href/xlink:href of <image> elements.
		$use_errors = libxml_use_internal_errors( true );
		$doc        = new \DOMDocument();
		if ( $doc->loadXML( $svg_content ) ) {
			$xpath          = new \DOMXPath( $doc );
			$xlink_ns       = 'http://www.w3.org/1999/xlink';
			$image_elements = $xpath->query( '//*[local-name()="image"]' );

			foreach ( $image_elements as $image ) {
				$href = $image->getAttribute( 'href' );
				if ( empty( $href ) ) {
					$href = $image->getAttributeNS( $xlink_ns, 'href' );
				}
				if ( preg_match_all( '/\{\{([a-zA-Z_]\w*)\}\}/', $href, $href_matches ) ) {
					foreach ( $href_matches[1] as $name ) {
						if ( ! isset( $seen_names[ $name ] ) ) {
							$seen_names[ $name ] = true;
							$entry               = array( 'name' => $name );
							$width               = $image->getAttribute( 'width' );
							$height              = $image->getAttribute( 'height' );
							if ( '' !== $width && '' !== $height ) {
								$entry['width']  = (int) round( (float) $width );
								$entry['height'] = (int) round( (float) $height );
							}
							$images[] = $entry;
						}
					}
				}
			}
		}
		libxml_clear_errors();
		libxml_use_internal_errors( $use_errors );

		return $images;
	}

	/**
	 * Parse all {{name}} placeholders from SVG content.
	 *
	 * @param string $svg_content SVG content.
	 * @return array Array of all placeholder names.
	 */
	private function parse_all_placeholders( $svg_content ) {
		$all = array();
		if ( preg_match_all( '/\{\{(?!image:)([a-zA-Z_]\w*)\}\}/', $svg_content, $matches ) ) {
			$all = array_unique( $matches[1] );
		}
		return array_values( $all );
	}

	/**
	 * Prepare a template object for API response.
	 *
	 * @param \WP_Post $post Attachment post object.
	 * @return array Template data.
	 */
	private function prepare_template( $post ) {
		$variables = get_post_meta( $post->ID, self::VARIABLES_META_KEY, true );
		$images    = get_post_meta( $post->ID, self::IMAGES_META_KEY, true );

		return array(
			'id'        => $post->ID,
			'title'     => $post->post_title,
			'url'       => wp_get_attachment_url( $post->ID ),
			'variables' => is_array( $variables ) ? $variables : array(),
			'images'    => is_array( $images ) ? $images : array(),
		);
	}
}
