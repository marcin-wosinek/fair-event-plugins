<?php
/**
 * Migration REST API Controller
 *
 * @package FairTeam
 */

namespace FairTeam\API;

use FairTeam\PostTypes\TeamMember;
use FairTeam\Services\PostMigrationService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Controller for post migration endpoints
 */
class MigrationController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-team/v1';

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'migration';

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// Get available post types.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/post-types',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_post_types' ),
					'permission_callback' => 'is_user_logged_in',
				),
			)
		);

		// Get categories for filtering.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/categories',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_categories' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'post_type' => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// Get posts list.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/posts',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_posts' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'post_type' => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'category'  => array(
							'required'          => false,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'per_page'  => array(
							'required'          => false,
							'type'              => 'integer',
							'default'           => 20,
							'sanitize_callback' => 'absint',
						),
						'page'      => array(
							'required'          => false,
							'type'              => 'integer',
							'default'           => 1,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		// Migrate post.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/migrate',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'migrate_post' ),
					'permission_callback' => array( $this, 'migrate_post_permissions_check' ),
					'args'                => array(
						'post_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
							'validate_callback' => function ( $param ) {
								return $param > 0;
							},
						),
					),
				),
			)
		);
	}

	/**
	 * Get available post types
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_post_types( $request ) {
		$post_types = get_post_types(
			array(
				'public' => true,
			),
			'objects'
		);

		$options = array();

		foreach ( $post_types as $post_type ) {
			// Exclude team member post type.
			if ( TeamMember::POST_TYPE === $post_type->name ) {
				continue;
			}

			$options[] = array(
				'value' => $post_type->name,
				'label' => $post_type->label,
			);
		}

		return rest_ensure_response( $options );
	}

	/**
	 * Get categories for filtering
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_categories( $request ) {
		$post_type = $request->get_param( 'post_type' );

		$options = array(
			array(
				'value' => '',
				'label' => __( 'All Categories', 'fair-team' ),
			),
		);

		// Get taxonomies for this post type.
		$taxonomies = array();
		if ( $post_type ) {
			$taxonomies = get_object_taxonomies( $post_type, 'names' );
		} else {
			$taxonomies = array( 'category' );
		}

		// Get terms from all relevant taxonomies.
		foreach ( $taxonomies as $taxonomy ) {
			$terms = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
				)
			);

			if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
				foreach ( $terms as $term ) {
					$options[] = array(
						'value' => $term->term_id,
						'label' => $term->name,
					);
				}
			}
		}

		return rest_ensure_response( $options );
	}

	/**
	 * Get posts for migration
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_posts( $request ) {
		$post_type = $request->get_param( 'post_type' );
		$category  = $request->get_param( 'category' );
		$per_page  = $request->get_param( 'per_page' );
		$page      = $request->get_param( 'page' );

		// Limit per_page to prevent performance issues.
		$per_page = min( $per_page, 100 );

		$args = array(
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'date',
			'order'          => 'DESC',
		);

		// Filter by post type.
		if ( $post_type ) {
			$args['post_type'] = $post_type;
		} else {
			// Get all public post types except team member.
			$post_types = get_post_types(
				array(
					'public' => true,
				),
				'names'
			);
			unset( $post_types[ TeamMember::POST_TYPE ] );
			$args['post_type'] = array_values( $post_types );
		}

		// Filter by category.
		if ( $category ) {
			$args['tax_query'] = array(
				array(
					'taxonomy' => 'category',
					'field'    => 'term_id',
					'terms'    => $category,
				),
			);
		}

		$query = new \WP_Query( $args );

		$posts = array();
		foreach ( $query->posts as $post ) {
			$post_type_object = get_post_type_object( $post->post_type );
			$author           = get_userdata( $post->post_author );

			$posts[] = array(
				'id'              => $post->ID,
				'title'           => $post->post_title,
				'post_type'       => $post->post_type,
				'post_type_label' => $post_type_object ? $post_type_object->labels->singular_name : $post->post_type,
				'author'          => $author ? $author->display_name : '',
				'date'            => get_the_date( '', $post->ID ),
				'edit_link'       => get_edit_post_link( $post->ID, 'raw' ),
			);
		}

		return rest_ensure_response(
			array(
				'posts'       => $posts,
				'total'       => $query->found_posts,
				'total_pages' => $query->max_num_pages,
			)
		);
	}

	/**
	 * Migrate a post to team member
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function migrate_post( $request ) {
		$post_id = $request->get_param( 'post_id' );

		$migration_service = new PostMigrationService();
		$team_member_id    = $migration_service->migrate_post( $post_id );

		if ( is_wp_error( $team_member_id ) ) {
			return $team_member_id;
		}

		return rest_ensure_response(
			array(
				'success'        => true,
				'message'        => __( 'Post migrated successfully to team member.', 'fair-team' ),
				'team_member_id' => $team_member_id,
			)
		);
	}

	/**
	 * Check permissions for migration
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function migrate_post_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
