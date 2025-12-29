<?php
/**
 * Meta Box Hooks
 *
 * @package FairTeam
 */

namespace FairTeam\Hooks;

defined( 'WPINC' ) || die;

/**
 * Class for registering team member meta boxes.
 *
 * Adds a meta box to all public post types (except team members themselves)
 * allowing users to link team members to posts.
 */
class MetaBoxHooks {

	/**
	 * Initialize hooks.
	 */
	public function init() {
		add_action( 'add_meta_boxes', array( $this, 'add_team_members_meta_box' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_meta_box_scripts' ) );
	}

	/**
	 * Add team members meta box to all public post types.
	 */
	public function add_team_members_meta_box() {
		$post_types = get_post_types( array( 'public' => true ), 'names' );

		// Remove team member post type from the list.
		unset( $post_types['fair_team_member'] );

		foreach ( $post_types as $post_type ) {
			add_meta_box(
				'fair_team_members',
				__( 'Team Members', 'fair-team' ),
				array( $this, 'render_meta_box' ),
				$post_type,
				'side',
				'default'
			);
		}
	}

	/**
	 * Render the meta box.
	 *
	 * @param WP_Post $post Current post object.
	 */
	public function render_meta_box( $post ) {
		wp_nonce_field( 'fair_team_members_meta_box', 'fair_team_members_nonce' );
		?>
		<div id="fair-team-members-root"></div>
		<p class="description">
			<?php esc_html_e( 'Add team members associated with this post.', 'fair-team' ); ?>
		</p>
		<?php
	}

	/**
	 * Enqueue scripts for the meta box.
	 *
	 * @param string $hook Current admin page hook.
	 */
	public function enqueue_meta_box_scripts( $hook ) {
		// Only load on post edit pages.
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}

		$screen = get_current_screen();
		if ( ! $screen || 'fair_team_member' === $screen->post_type ) {
			return;
		}

		$asset_file = include FAIR_TEAM_PLUGIN_DIR . 'build/admin/post-team-members/index.asset.php';

		wp_enqueue_script(
			'fair-team-post-team-members',
			FAIR_TEAM_PLUGIN_URL . 'build/admin/post-team-members/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );

		wp_localize_script(
			'fair-team-post-team-members',
			'fairTeamMembersData',
			array(
				'postId'  => get_the_ID(),
				'nonce'   => wp_create_nonce( 'fair_team_members' ),
				'restUrl' => rest_url(),
			)
		);
	}
}
