<?php
/**
 * Frontend Attendance Check Hooks
 *
 * @package FairRsvp
 */

namespace FairRsvp\Frontend;

defined( 'WPINC' ) || die;

/**
 * Handles rewrite rules and query vars for attendance check page
 */
class AttendanceCheckHooks {

	/**
	 * Constructor - registers hooks
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_rewrite_rules' ) );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_action( 'template_redirect', array( $this, 'handle_attendance_check' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_scripts' ) );
	}

	/**
	 * Register rewrite rules for attendance check URLs
	 *
	 * @return void
	 */
	public function register_rewrite_rules() {
		// Pattern: /{post-type-slug}/{slug}/attendance/ - for custom post types with rewrite slug.
		add_rewrite_rule(
			'([^/]+)/([^/]+)/attendance/?$',
			'index.php?post_slug=$matches[2]&attendance_check=1',
			'top'
		);

		// Pattern: /{slug}/attendance/ - for posts/pages without additional slug.
		add_rewrite_rule(
			'([^/]+)/attendance/?$',
			'index.php?post_slug=$matches[1]&attendance_check=1',
			'top'
		);
	}

	/**
	 * Add custom query vars
	 *
	 * @param array $vars Existing query vars.
	 * @return array Modified query vars.
	 */
	public function add_query_vars( $vars ) {
		$vars[] = 'attendance_check';
		$vars[] = 'post_slug';
		return $vars;
	}

	/**
	 * Handle attendance check page requests
	 *
	 * @return void
	 */
	public function handle_attendance_check() {
		// Check if this is an attendance check request.
		if ( ! get_query_var( 'attendance_check' ) ) {
			return;
		}

		// Get the post slug from query var.
		$post_slug = get_query_var( 'post_slug' );
		if ( ! $post_slug ) {
			wp_die( esc_html__( 'Post not found.', 'fair-rsvp' ), 404 );
		}

		// Query for the post by slug (any post type).
		$posts = get_posts(
			array(
				'name'           => $post_slug,
				'post_type'      => 'any',
				'post_status'    => 'publish',
				'posts_per_page' => 1,
			)
		);

		if ( empty( $posts ) ) {
			wp_die( esc_html__( 'Post not found.', 'fair-rsvp' ), 404 );
		}

		$post = $posts[0];

		// Check if post has RSVP block.
		if ( ! has_block( 'fair-rsvp/rsvp-button', $post ) ) {
			wp_die( esc_html__( 'This post does not have an RSVP block.', 'fair-rsvp' ), 404 );
		}

		// Initialize and render the attendance check page.
		$page = new AttendanceCheckPage( $post );
		$page->render();
		exit;
	}

	/**
	 * Enqueue scripts for attendance check page
	 *
	 * @return void
	 */
	public function enqueue_scripts() {
		// Only enqueue on attendance check page.
		if ( ! get_query_var( 'attendance_check' ) ) {
			return;
		}

		// Get asset file.
		$asset_file = plugin_dir_path( dirname( __DIR__, 1 ) ) . 'build/admin/attendance-check/index.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = require $asset_file;

		// Enqueue script.
		wp_enqueue_script(
			'fair-rsvp-attendance-check',
			plugins_url( 'build/admin/attendance-check/index.js', dirname( __DIR__, 1 ) ),
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// Set script translations.
		wp_set_script_translations(
			'fair-rsvp-attendance-check',
			'fair-rsvp',
			plugin_dir_path( dirname( __DIR__, 1 ) ) . 'build/languages'
		);

		// Enqueue WordPress components styles.
		wp_enqueue_style( 'wp-components' );
	}
}
