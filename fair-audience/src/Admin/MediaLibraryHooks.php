<?php
/**
 * Media Library Hooks
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

use FairAudience\Database\PhotoParticipantRepository;
use FairAudience\Database\ParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Media Library integration for photo authors.
 */
class MediaLibraryHooks {

	/**
	 * Initialize hooks for media library.
	 */
	public static function init() {
		// Add author field to attachment details.
		add_filter( 'attachment_fields_to_edit', array( __CLASS__, 'add_author_field' ), 10, 2 );
		add_filter( 'attachment_fields_to_save', array( __CLASS__, 'save_author_field' ), 10, 2 );

		// Add dropdown filter to media library.
		add_action( 'restrict_manage_posts', array( __CLASS__, 'add_author_filter_dropdown' ) );
		add_filter( 'pre_get_posts', array( __CLASS__, 'filter_by_author' ) );

		// Add author column to media library.
		add_filter( 'manage_media_columns', array( __CLASS__, 'add_author_column' ) );
		add_action( 'manage_media_custom_column', array( __CLASS__, 'display_author_column' ), 10, 2 );

		// Make likes column sortable.
		add_filter( 'manage_upload_sortable_columns', array( __CLASS__, 'add_sortable_columns' ) );
		add_action( 'pre_get_posts', array( __CLASS__, 'sort_by_likes' ) );

		// Bulk upload page.
		add_action( 'post-upload-ui', array( __CLASS__, 'add_bulk_upload_author_selector' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_bulk_upload_scripts' ) );
		add_action( 'add_attachment', array( __CLASS__, 'auto_assign_author_on_upload' ) );
		add_action( 'wp_ajax_fair_audience_set_bulk_upload_author', array( __CLASS__, 'ajax_set_bulk_upload_author' ) );

		// Media modal filter (JavaScript-based).
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_media_modal_scripts' ) );
		add_filter( 'ajax_query_attachments_args', array( __CLASS__, 'filter_ajax_attachments_by_author' ) );
	}

	/**
	 * Get all participants for dropdown.
	 *
	 * @return array Array of participants with id and display name.
	 */
	private static function get_participants_for_dropdown() {
		$repository   = new ParticipantRepository();
		$participants = $repository->get_all();

		return array_map(
			function ( $p ) {
				return array(
					'id'   => $p->id,
					'name' => trim( $p->name . ' ' . $p->surname ),
				);
			},
			$participants
		);
	}

	/**
	 * Add author selector field to attachment edit screen.
	 *
	 * @param array   $form_fields Form fields array.
	 * @param WP_Post $post        Post object.
	 * @return array Modified form fields.
	 */
	public static function add_author_field( $form_fields, $post ) {
		$repository        = new PhotoParticipantRepository();
		$author            = $repository->get_author_for_attachment( $post->ID );
		$current_author_id = $author ? $author->participant_id : 0;

		$participants = self::get_participants_for_dropdown();

		$options = '<option value="">' . __( '— Select Author —', 'fair-audience' ) . '</option>';
		foreach ( $participants as $participant ) {
			$selected = selected( $current_author_id, $participant['id'], false );
			$options .= sprintf(
				'<option value="%d"%s>%s</option>',
				$participant['id'],
				$selected,
				esc_html( $participant['name'] )
			);
		}

		$form_fields['fair_photo_author'] = array(
			'label' => __( 'Photo Author', 'fair-audience' ),
			'input' => 'html',
			'html'  => sprintf(
				'<select name="attachments[%d][fair_photo_author]" id="attachments-%d-fair_photo_author">%s</select>',
				$post->ID,
				$post->ID,
				$options
			),
			'helps' => __( 'Who took this photo', 'fair-audience' ),
		);

		return $form_fields;
	}

	/**
	 * Save author assignment for attachment.
	 *
	 * @param array $post       Post data array.
	 * @param array $attachment Attachment data array.
	 * @return array Modified post data.
	 */
	public static function save_author_field( $post, $attachment ) {
		if ( ! isset( $attachment['fair_photo_author'] ) ) {
			return $post;
		}

		$participant_id = absint( $attachment['fair_photo_author'] );
		$repository     = new PhotoParticipantRepository();
		$repository->set_author( $post['ID'], $participant_id );

		return $post;
	}

	/**
	 * Add author filter dropdown to media library.
	 */
	public static function add_author_filter_dropdown() {
		global $pagenow;

		if ( 'upload.php' !== $pagenow ) {
			return;
		}

		$selected = isset( $_GET['fair_photo_author_filter'] ) ? absint( $_GET['fair_photo_author_filter'] ) : 0;

		$participants = self::get_participants_for_dropdown();

		echo '<select name="fair_photo_author_filter">';
		echo '<option value="">' . esc_html__( 'All Authors', 'fair-audience' ) . '</option>';
		foreach ( $participants as $participant ) {
			printf(
				'<option value="%d"%s>%s</option>',
				$participant['id'],
				selected( $selected, $participant['id'], false ),
				esc_html( $participant['name'] )
			);
		}
		echo '</select>';
	}

	/**
	 * Filter media library by selected author.
	 *
	 * @param WP_Query $query Query object.
	 */
	public static function filter_by_author( $query ) {
		global $pagenow;

		if ( 'upload.php' !== $pagenow || ! $query->is_main_query() ) {
			return;
		}

		if ( empty( $_GET['fair_photo_author_filter'] ) ) {
			return;
		}

		$participant_id = absint( $_GET['fair_photo_author_filter'] );
		$repository     = new PhotoParticipantRepository();
		$attachment_ids = $repository->get_attachment_ids_by_participant( $participant_id, 'author' );

		if ( ! empty( $attachment_ids ) ) {
			$query->set( 'post__in', $attachment_ids );
		} else {
			// No photos by this author, show empty results.
			$query->set( 'post__in', array( 0 ) );
		}
	}

	/**
	 * Add author and likes columns to media library list.
	 *
	 * @param array $columns Columns array.
	 * @return array Modified columns.
	 */
	public static function add_author_column( $columns ) {
		$columns['fair_photo_author'] = __( 'Photo Author', 'fair-audience' );
		$columns['fair_photo_likes']  = __( 'Likes', 'fair-audience' );
		return $columns;
	}

	/**
	 * Display author name in media library column.
	 *
	 * @param string $column_name Column name.
	 * @param int    $post_id     Post ID.
	 */
	public static function display_author_column( $column_name, $post_id ) {
		if ( 'fair_photo_author' === $column_name ) {
			$repository = new PhotoParticipantRepository();
			$author     = $repository->get_author_for_attachment( $post_id );

			if ( ! $author ) {
				echo '—';
				return;
			}

			$participant_repo = new ParticipantRepository();
			$participant      = $participant_repo->get_by_id( $author->participant_id );

			if ( $participant ) {
				echo esc_html( trim( $participant->name . ' ' . $participant->surname ) );
			} else {
				echo '—';
			}
		} elseif ( 'fair_photo_likes' === $column_name ) {
			$likes_count = self::get_likes_count_for_attachment( $post_id );
			echo esc_html( $likes_count );
		}
	}

	/**
	 * Get the number of likes for an attachment.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return int Number of likes.
	 */
	private static function get_likes_count_for_attachment( $attachment_id ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$count = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->prefix}fair_events_photo_likes WHERE attachment_id = %d",
				$attachment_id
			)
		);

		return (int) $count;
	}

	/**
	 * Add sortable columns for media library.
	 *
	 * @param array $columns Sortable columns array.
	 * @return array Modified sortable columns.
	 */
	public static function add_sortable_columns( $columns ) {
		$columns['fair_photo_likes'] = 'fair_photo_likes';
		return $columns;
	}

	/**
	 * Handle sorting by likes count.
	 *
	 * @param WP_Query $query Query object.
	 */
	public static function sort_by_likes( $query ) {
		global $pagenow, $wpdb;

		if ( 'upload.php' !== $pagenow || ! $query->is_main_query() ) {
			return;
		}

		$orderby = $query->get( 'orderby' );

		if ( 'fair_photo_likes' !== $orderby ) {
			return;
		}

		// Get all attachment IDs with their likes count, sorted.
		$order = strtoupper( $query->get( 'order' ) ) === 'ASC' ? 'ASC' : 'DESC';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$sorted_ids = $wpdb->get_col(
			"SELECT p.ID
			FROM {$wpdb->posts} p
			LEFT JOIN (
				SELECT attachment_id, COUNT(*) as likes_count
				FROM {$wpdb->prefix}fair_events_photo_likes
				GROUP BY attachment_id
			) pl ON p.ID = pl.attachment_id
			WHERE p.post_type = 'attachment'
			ORDER BY COALESCE(pl.likes_count, 0) {$order}, p.ID DESC"
		);

		if ( ! empty( $sorted_ids ) ) {
			$query->set( 'post__in', $sorted_ids );
			$query->set( 'orderby', 'post__in' );
		}
	}

	/**
	 * Add author selector to bulk upload page.
	 */
	public static function add_bulk_upload_author_selector() {
		$participants = self::get_participants_for_dropdown();
		$selected     = get_user_meta( get_current_user_id(), 'fair_audience_bulk_upload_author', true );

		?>
		<div id="fair-audience-bulk-upload" style="margin: 20px 0; padding: 15px; background: #f0f0f1; border: 1px solid #c3c4c7; border-radius: 4px;">
			<h3 style="margin-top: 0;"><?php esc_html_e( 'Photo Author', 'fair-audience' ); ?></h3>
			<p class="description">
				<?php esc_html_e( 'Automatically assign an author to uploaded photos. Select an author below before uploading.', 'fair-audience' ); ?>
			</p>
			<p>
				<label for="fair-audience-bulk-upload-selector">
					<strong><?php esc_html_e( 'Author:', 'fair-audience' ); ?></strong>
				</label>
				<select id="fair-audience-bulk-upload-selector" style="margin-left: 10px; min-width: 250px;">
					<option value=""><?php esc_html_e( '— No Author (Manual Assignment) —', 'fair-audience' ); ?></option>
					<?php foreach ( $participants as $participant ) : ?>
						<option value="<?php echo esc_attr( $participant['id'] ); ?>" <?php selected( $selected, $participant['id'] ); ?>>
							<?php echo esc_html( $participant['name'] ); ?>
						</option>
					<?php endforeach; ?>
				</select>
				<span id="fair-audience-bulk-upload-status" style="margin-left: 10px; color: #666;"></span>
			</p>
		</div>
		<?php
	}

	/**
	 * Enqueue scripts for bulk upload page.
	 *
	 * @param string $hook Hook suffix.
	 */
	public static function enqueue_bulk_upload_scripts( $hook ) {
		if ( 'media-new.php' !== $hook ) {
			return;
		}

		wp_enqueue_script( 'jquery' );

		wp_add_inline_script(
			'jquery',
			"
			jQuery(document).ready(function($) {
				$('#fair-audience-bulk-upload-selector').on('change', function() {
					var authorId = $(this).val();
					var statusEl = $('#fair-audience-bulk-upload-status');

					statusEl.text('" . esc_js( __( 'Saving...', 'fair-audience' ) ) . "').css('color', '#666');

					$.post(ajaxurl, {
						action: 'fair_audience_set_bulk_upload_author',
						author_id: authorId,
						nonce: '" . wp_create_nonce( 'fair_audience_bulk_upload' ) . "'
					}, function(response) {
						if (response.success) {
							if (authorId) {
								statusEl.text('" . esc_js( __( 'Selected. New uploads will be credited to this author.', 'fair-audience' ) ) . "').css('color', '#00a32a');
							} else {
								statusEl.text('').css('color', '#666');
							}
						} else {
							statusEl.text('" . esc_js( __( 'Error saving selection', 'fair-audience' ) ) . "').css('color', '#d63638');
						}
					}).fail(function(xhr, status, error) {
						statusEl.text('" . esc_js( __( 'Error:', 'fair-audience' ) ) . " ' + error).css('color', '#d63638');
					});
				});
			});
			"
		);
	}

	/**
	 * AJAX handler to save selected author for bulk upload.
	 */
	public static function ajax_set_bulk_upload_author() {
		check_ajax_referer( 'fair_audience_bulk_upload', 'nonce' );

		if ( ! current_user_can( 'upload_files' ) ) {
			wp_send_json_error();
		}

		$author_id = isset( $_POST['author_id'] ) ? absint( $_POST['author_id'] ) : 0;
		$user_id   = get_current_user_id();

		update_user_meta( $user_id, 'fair_audience_bulk_upload_author', $author_id );

		wp_send_json_success( array( 'saved_author_id' => $author_id ) );
	}

	/**
	 * Automatically assign author to newly uploaded attachments.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	public static function auto_assign_author_on_upload( $attachment_id ) {
		// Check if this is an image or video.
		if ( ! wp_attachment_is( 'image', $attachment_id ) && ! wp_attachment_is( 'video', $attachment_id ) ) {
			return;
		}

		// Get the selected author for bulk upload.
		$author_id = get_user_meta( get_current_user_id(), 'fair_audience_bulk_upload_author', true );

		if ( ! $author_id ) {
			return;
		}

		// Verify participant exists.
		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( $author_id );

		if ( ! $participant ) {
			return;
		}

		// Assign author.
		$repository = new PhotoParticipantRepository();
		$repository->set_author( $attachment_id, $author_id );
	}

	/**
	 * Enqueue scripts for media modal filter.
	 *
	 * @param string $hook Hook suffix.
	 */
	public static function enqueue_media_modal_scripts( $hook ) {
		// Only load on pages that use the media modal.
		$allowed_hooks = array( 'upload.php', 'post.php', 'post-new.php' );
		if ( ! in_array( $hook, $allowed_hooks, true ) ) {
			return;
		}

		// Ensure media scripts are loaded.
		wp_enqueue_media();

		$asset_file = FAIR_AUDIENCE_PLUGIN_DIR . 'build/admin/media-library-filter.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = include $asset_file;

		wp_enqueue_script(
			'fair-audience-media-library-filter',
			FAIR_AUDIENCE_PLUGIN_URL . 'build/admin/media-library-filter.js',
			array_merge( $asset['dependencies'], array( 'media-views' ) ),
			$asset['version'],
			true
		);

		// Pass participant data to JavaScript.
		wp_localize_script(
			'fair-audience-media-library-filter',
			'fairAudienceMedia',
			array(
				'allAuthors'   => __( 'All Authors', 'fair-audience' ),
				'participants' => self::get_participants_for_dropdown(),
			)
		);
	}

	/**
	 * Filter AJAX attachment query for media modal author filter.
	 *
	 * @param array $query Query arguments.
	 * @return array Modified query arguments.
	 */
	public static function filter_ajax_attachments_by_author( $query ) {
		// Check if our custom filter parameter is set.
		// WordPress strips custom params, so we read directly from $_REQUEST.
		if ( empty( $_REQUEST['query']['fair_photo_author'] ) ) {
			return $query;
		}

		$participant_id = absint( $_REQUEST['query']['fair_photo_author'] );
		if ( ! $participant_id ) {
			return $query;
		}

		$repository     = new PhotoParticipantRepository();
		$attachment_ids = $repository->get_attachment_ids_by_participant( $participant_id, 'author' );

		if ( ! empty( $attachment_ids ) ) {
			$query['post__in'] = $attachment_ids;
		} else {
			// No photos by this author, show empty results.
			$query['post__in'] = array( 0 );
		}

		return $query;
	}
}
