<?php
/**
 * REST API Controller for event categories
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles the `category` taxonomy REST endpoints used by the event editor
 */
class CategoriesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for categories
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/sources/categories - Get available categories.
		// POST /fair-events/v1/sources/categories - Create category.
		register_rest_route(
			$this->namespace,
			'/sources/categories',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'all_languages' => array(
							'description'       => __( 'Whether to include categories from every configured Polylang language.', 'fair-events' ),
							'type'              => 'boolean',
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'name' => array(
							'description' => __( 'Name of the category to create.', 'fair-events' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get available categories for event categorization
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$all_languages    = (bool) $request->get_param( 'all_languages' );
		$include_language = $all_languages && function_exists( 'pll_get_term_language' );

		$args = array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
			'orderby'    => 'name',
			'order'      => 'ASC',
		);

		if ( $include_language ) {
			// Explicit empty 'lang' disables Polylang's automatic filtering
			// for this query, so terms from every configured language come
			// back instead of only the current one.
			$args['lang'] = '';
		}

		$categories = get_terms( $args );

		if ( is_wp_error( $categories ) ) {
			return new WP_REST_Response( array(), 200 );
		}

		$formatted = array_map(
			function ( $category ) use ( $include_language ) {
				$item = array(
					'id'   => $category->term_id,
					'name' => $category->name,
					'slug' => $category->slug,
				);

				if ( $include_language ) {
					$language = pll_get_term_language( $category->term_id, 'name' );
					if ( $language ) {
						$item['language'] = $language;
					}
				}

				return $item;
			},
			$categories
		);

		return new WP_REST_Response( $formatted, 200 );
	}

	/**
	 * Create a new category for event categorization
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$name = sanitize_text_field( $request->get_param( 'name' ) );

		if ( empty( $name ) ) {
			return new WP_Error(
				'rest_invalid_category_name',
				__( 'Category name is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$existing = get_term_by( 'name', $name, 'category' );
		if ( $existing ) {
			return new WP_REST_Response(
				array(
					'id'   => $existing->term_id,
					'name' => $existing->name,
					'slug' => $existing->slug,
				),
				200
			);
		}

		$result = wp_insert_term( $name, 'category' );

		if ( is_wp_error( $result ) ) {
			return new WP_Error(
				'rest_category_creation_failed',
				$result->get_error_message(),
				array( 'status' => 500 )
			);
		}

		$term = get_term( $result['term_id'], 'category' );

		return new WP_REST_Response(
			array(
				'id'   => $term->term_id,
				'name' => $term->name,
				'slug' => $term->slug,
			),
			201
		);
	}

	/**
	 * Check permissions for getting categories
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for creating a category
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_categories' );
	}
}
