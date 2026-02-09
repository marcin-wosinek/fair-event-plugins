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

		// Replace text placeholders with XML-escaped values.
		if ( is_array( $variables ) ) {
			foreach ( $variables as $name => $value ) {
				$escaped_value = htmlspecialchars( $value, ENT_XML1, 'UTF-8' );
				$svg_content   = str_replace( '{{' . $name . '}}', $escaped_value, $svg_content );
			}
		}

		// Replace image placeholders with base64 data URIs.
		if ( is_array( $images ) ) {
			foreach ( $images as $name => $attachment_id ) {
				$image_path = get_attached_file( absint( $attachment_id ) );
				if ( ! $image_path || ! file_exists( $image_path ) ) {
					continue;
				}

				$image_data = file_get_contents( $image_path );
				if ( false === $image_data ) {
					continue;
				}

				$mime_type   = get_post_mime_type( absint( $attachment_id ) );
				$base64      = base64_encode( $image_data );
				$data_uri    = 'data:' . $mime_type . ';base64,' . $base64;
				$svg_content = str_replace( '{{image:' . $name . '}}', $data_uri, $svg_content );
			}
		}

		return new WP_REST_Response( array( 'svg' => $svg_content ), 200 );
	}

	/**
	 * Parse text placeholders from SVG content.
	 *
	 * @param string $svg_content SVG content.
	 * @return array Array of variable names.
	 */
	private function parse_text_placeholders( $svg_content ) {
		$variables = array();
		// Match {{name}} but not {{image:name}}.
		if ( preg_match_all( '/\{\{(?!image:)([a-zA-Z_]\w*)\}\}/', $svg_content, $matches ) ) {
			$variables = array_unique( $matches[1] );
			$variables = array_values( $variables );
		}
		return $variables;
	}

	/**
	 * Parse image placeholders from SVG content.
	 *
	 * @param string $svg_content SVG content.
	 * @return array Array of image placeholder names.
	 */
	private function parse_image_placeholders( $svg_content ) {
		$images = array();
		if ( preg_match_all( '/\{\{image:([a-zA-Z_]\w*)\}\}/', $svg_content, $matches ) ) {
			$images = array_unique( $matches[1] );
			$images = array_values( $images );
		}
		return $images;
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
