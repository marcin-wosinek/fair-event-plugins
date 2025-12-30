<?php
/**
 * Team Member Post Type
 *
 * @package FairTeam
 */

namespace FairTeam\PostTypes;

defined( 'WPINC' ) || die;

/**
 * Team Member custom post type
 */
class TeamMember {
	/**
	 * Post type slug
	 *
	 * @var string
	 */
	const POST_TYPE = 'fair_team_member';

	/**
	 * Register the Team Member post type
	 *
	 * @return void
	 */
	public static function register() {
		$labels = array(
			'name'                  => _x( 'Team Members', 'Post type general name', 'fair-team' ),
			'singular_name'         => _x( 'Team Member', 'Post type singular name', 'fair-team' ),
			'menu_name'             => _x( 'Team Members', 'Admin Menu text', 'fair-team' ),
			'name_admin_bar'        => _x( 'Team Member', 'Add New on Toolbar', 'fair-team' ),
			'add_new'               => __( 'Add New', 'fair-team' ),
			'add_new_item'          => __( 'Add New Team Member', 'fair-team' ),
			'new_item'              => __( 'New Team Member', 'fair-team' ),
			'edit_item'             => __( 'Edit Team Member', 'fair-team' ),
			'view_item'             => __( 'View Team Member', 'fair-team' ),
			'all_items'             => __( 'All Team Members', 'fair-team' ),
			'search_items'          => __( 'Search Team Members', 'fair-team' ),
			'not_found'             => __( 'No team members found.', 'fair-team' ),
			'not_found_in_trash'    => __( 'No team members found in Trash.', 'fair-team' ),
			'featured_image'        => _x( 'Profile Photo', 'Overrides the "Featured Image" phrase', 'fair-team' ),
			'set_featured_image'    => _x( 'Set profile photo', 'Overrides the "Set featured image" phrase', 'fair-team' ),
			'remove_featured_image' => _x( 'Remove profile photo', 'Overrides the "Remove featured image" phrase', 'fair-team' ),
			'use_featured_image'    => _x( 'Use as profile photo', 'Overrides the "Use as featured image" phrase', 'fair-team' ),
			'archives'              => _x( 'Team Member archives', 'The post type archive label', 'fair-team' ),
			'insert_into_item'      => _x( 'Insert into team member', 'Overrides the "Insert into post" phrase', 'fair-team' ),
			'uploaded_to_this_item' => _x( 'Uploaded to this team member', 'Overrides the "Uploaded to this post" phrase', 'fair-team' ),
			'filter_items_list'     => _x( 'Filter team members list', 'Screen reader text for the filter links', 'fair-team' ),
			'items_list_navigation' => _x( 'Team members list navigation', 'Screen reader text for the pagination', 'fair-team' ),
			'items_list'            => _x( 'Team members list', 'Screen reader text for the items list', 'fair-team' ),
		);

		// Get slug from settings, fallback to default
		$slug = get_option( 'fair_team_slug', 'team-member' );

		$args = array(
			'labels'             => $labels,
			'public'             => true,
			'publicly_queryable' => true,
			'show_ui'            => true,
			'show_in_menu'       => true,
			'query_var'          => true,
			'rewrite'            => array( 'slug' => $slug ),
			'capability_type'    => 'post',
			'has_archive'        => true,
			'hierarchical'       => false,
			'menu_position'      => 21,
			'menu_icon'          => 'dashicons-groups',
			'supports'           => array( 'title', 'editor', 'author', 'thumbnail', 'excerpt' ),
			'show_in_rest'       => true,
		);

		register_post_type( self::POST_TYPE, $args );

		self::register_meta();
		self::register_meta_box();
		self::register_admin_columns();
		self::register_title_filter();
	}

	/**
	 * Register custom meta fields for Team Member post type
	 *
	 * @return void
	 */
	public static function register_meta() {
		register_post_meta(
			self::POST_TYPE,
			'team_member_user_id',
			array(
				'type'              => 'integer',
				'description'       => __( 'WordPress user ID linked to this team member', 'fair-team' ),
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'absint',
				'default'           => 0,
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'team_member_instagram',
			array(
				'type'              => 'string',
				'description'       => __( 'Instagram account URL', 'fair-team' ),
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'esc_url_raw',
				'default'           => '',
			)
		);
	}

	/**
	 * Register meta box for team member details
	 *
	 * @return void
	 */
	public static function register_meta_box() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
		add_action( 'save_post', array( __CLASS__, 'save_meta_box' ) );
	}

	/**
	 * Add meta box for team member details
	 *
	 * @return void
	 */
	public static function add_meta_box() {
		add_meta_box(
			'fair_team_member_details',
			__( 'Team Member Details', 'fair-team' ),
			array( __CLASS__, 'render_meta_box' ),
			self::POST_TYPE,
			'side',
			'default'
		);
	}

	/**
	 * Render meta box content
	 *
	 * @param \WP_Post $post The post object.
	 * @return void
	 */
	public static function render_meta_box( $post ) {
		wp_nonce_field( 'fair_team_member_meta_box', 'fair_team_member_meta_box_nonce' );

		$user_id   = get_post_meta( $post->ID, 'team_member_user_id', true );
		$instagram = get_post_meta( $post->ID, 'team_member_instagram', true );

		// Get all users for dropdown
		$users = get_users(
			array(
				'orderby' => 'display_name',
				'order'   => 'ASC',
			)
		);
		?>
		<p>
			<label for="team_member_user_id">
				<?php esc_html_e( 'WordPress User', 'fair-team' ); ?>
			</label>
			<select id="team_member_user_id" name="team_member_user_id" style="width: 100%;">
				<option value="0"><?php esc_html_e( '(None)', 'fair-team' ); ?></option>
				<?php foreach ( $users as $user ) : ?>
					<option value="<?php echo esc_attr( $user->ID ); ?>" <?php selected( $user_id, $user->ID ); ?>>
						<?php echo esc_html( $user->display_name ); ?>
					</option>
				<?php endforeach; ?>
			</select>
		</p>
		<p>
			<label for="team_member_instagram">
				<?php esc_html_e( 'Instagram URL', 'fair-team' ); ?>
			</label>
			<input
				type="url"
				id="team_member_instagram"
				name="team_member_instagram"
				value="<?php echo esc_url( $instagram ); ?>"
				style="width: 100%;"
				placeholder="https://instagram.com/username"
			/>
		</p>
		<?php
	}

	/**
	 * Save meta box data
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 */
	public static function save_meta_box( $post_id ) {
		// Check if nonce is set.
		if ( ! isset( $_POST['fair_team_member_meta_box_nonce'] ) ) {
			return;
		}

		// Verify nonce.
		if ( ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fair_team_member_meta_box_nonce'] ) ), 'fair_team_member_meta_box' ) ) {
			return;
		}

		// Check if this is an autosave.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		// Check user permissions.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		// Check if this is our post type.
		if ( self::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		// Save user ID
		if ( isset( $_POST['team_member_user_id'] ) ) {
			$user_id = absint( $_POST['team_member_user_id'] );

			// Validate user exists if non-zero
			if ( $user_id > 0 ) {
				$user = get_user_by( 'ID', $user_id );
				if ( ! $user ) {
					$user_id = 0; // Reset to 0 if user doesn't exist
				}
			}

			update_post_meta( $post_id, 'team_member_user_id', $user_id );
		}

		// Save Instagram URL
		if ( isset( $_POST['team_member_instagram'] ) ) {
			$instagram = esc_url_raw( wp_unslash( $_POST['team_member_instagram'] ) );
			update_post_meta( $post_id, 'team_member_instagram', $instagram );
		}
	}

	/**
	 * Register admin columns
	 *
	 * @return void
	 */
	public static function register_admin_columns() {
		add_filter( 'manage_' . self::POST_TYPE . '_posts_columns', array( __CLASS__, 'add_admin_columns' ) );
		add_action( 'manage_' . self::POST_TYPE . '_posts_custom_column', array( __CLASS__, 'render_admin_column' ), 10, 2 );
	}

	/**
	 * Add custom columns to admin list
	 *
	 * @param array $columns Existing columns.
	 * @return array Modified columns.
	 */
	public static function add_admin_columns( $columns ) {
		// Insert custom columns after title
		$new_columns = array();
		foreach ( $columns as $key => $value ) {
			$new_columns[ $key ] = $value;
			if ( $key === 'title' ) {
				$new_columns['user_link'] = __( 'Linked User', 'fair-team' );
				$new_columns['instagram'] = __( 'Instagram', 'fair-team' );
			}
		}
		return $new_columns;
	}

	/**
	 * Render custom column content
	 *
	 * @param string $column  Column name.
	 * @param int    $post_id Post ID.
	 * @return void
	 */
	public static function render_admin_column( $column, $post_id ) {
		if ( 'user_link' === $column ) {
			$user_id = get_post_meta( $post_id, 'team_member_user_id', true );
			if ( $user_id ) {
				$user = get_user_by( 'ID', $user_id );
				if ( $user ) {
					printf(
						'<a href="%s">%s</a>',
						esc_url( get_edit_user_link( $user_id ) ),
						esc_html( $user->display_name )
					);
				} else {
					echo '—';
				}
			} else {
				echo '—';
			}
		} elseif ( 'instagram' === $column ) {
			$instagram = get_post_meta( $post_id, 'team_member_instagram', true );
			if ( $instagram ) {
				// Extract username from URL
				$username = self::extract_instagram_username( $instagram );
				printf(
					'<a href="%s" target="_blank" rel="noopener noreferrer">@%s</a>',
					esc_url( $instagram ),
					esc_html( $username )
				);
			} else {
				echo '—';
			}
		}
	}

	/**
	 * Extract Instagram username from URL
	 *
	 * @param string $url Instagram URL.
	 * @return string Username or full URL if extraction fails.
	 */
	private static function extract_instagram_username( $url ) {
		// Try to extract username from URL like https://instagram.com/username
		if ( preg_match( '#instagram\.com/([^/?]+)#i', $url, $matches ) ) {
			return $matches[1];
		}
		return $url;
	}

	/**
	 * Register title filter
	 *
	 * @return void
	 */
	public static function register_title_filter() {
		add_filter( 'the_title', array( __CLASS__, 'modify_title_with_instagram' ), 10, 2 );
	}

	/**
	 * Modify title to include Instagram link if available
	 *
	 * @param string $title Post title.
	 * @param int    $post_id Post ID.
	 * @return string Modified title with Instagram link.
	 */
	public static function modify_title_with_instagram( $title, $post_id ) {
		// Only modify if this is a team member post type
		if ( self::POST_TYPE !== get_post_type( $post_id ) ) {
			return $title;
		}

		// Get Instagram URL
		$instagram = get_post_meta( $post_id, 'team_member_instagram', true );
		if ( empty( $instagram ) ) {
			return $title;
		}

		// Extract username
		$username = self::extract_instagram_username( $instagram );

		// Add Instagram link to title
		$instagram_link = sprintf(
			' <a href="%s" target="_blank" rel="noopener noreferrer">@%s</a>',
			esc_url( $instagram ),
			esc_html( $username )
		);

		return $title . $instagram_link;
	}
}
