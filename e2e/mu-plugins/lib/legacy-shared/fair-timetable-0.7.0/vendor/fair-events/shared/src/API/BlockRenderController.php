<?php
/**
 * REST API Controller for rendering blocks
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\API;

defined( 'WPINC' ) || die;

use FairEventsShared\BlockRenderer;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles block rendering REST API endpoint
 */
class BlockRenderController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events-shared/v1';

	/**
	 * Block renderer instance
	 *
	 * @var BlockRenderer
	 */
	private $renderer;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->renderer = new BlockRenderer();
	}

	/**
	 * Register the routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-events-shared/v1/render-block
		register_rest_route(
			$this->namespace,
			'/render-block',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'render_block' ),
					'permission_callback' => array( $this, 'render_block_permissions_check' ),
					'args'                => array(
						'name'       => array(
							'description'       => 'Block name (e.g. "fair-events/events-list").',
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'attributes' => array(
							'description' => 'Block attributes.',
							'type'        => 'object',
							'default'     => array(),
						),
						'postId'     => array(
							'description'       => 'Post ID for post context.',
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Render a block
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function render_block( $request ) {
		$block_name = $request->get_param( 'name' );
		$attributes = $request->get_param( 'attributes' ) ?? array();
		$post_id    = $request->get_param( 'postId' );

		$registry = \WP_Block_Type_Registry::get_instance();
		if ( ! $registry->is_registered( $block_name ) ) {
			return new WP_Error(
				'rest_block_not_found',
				sprintf( 'Block "%s" is not registered.', $block_name ),
				array( 'status' => 404 )
			);
		}

		$html = $this->renderer->render( $block_name, $attributes, $post_id );

		return new WP_REST_Response(
			array( 'html' => $html ),
			200
		);
	}

	/**
	 * Check permissions for rendering a block
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function render_block_permissions_check( $request ) {
		return is_user_logged_in();
	}
}
