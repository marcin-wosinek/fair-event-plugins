<?php
/**
 * Media Library Batch Actions
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\PhotoParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Handles batch actions for media library attachments.
 */
class MediaBatchActions {

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_filter( 'bulk_actions-upload', array( __CLASS__, 'register_bulk_actions' ) );
		add_filter( 'handle_bulk_actions-upload', array( __CLASS__, 'handle_bulk_action' ), 10, 3 );
		add_action( 'admin_menu', array( __CLASS__, 'register_batch_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'handle_form_submission' ) );
		add_action( 'admin_notices', array( __CLASS__, 'show_admin_notices' ) );
	}

	/**
	 * Register bulk actions in media library.
	 *
	 * @param array $actions Existing bulk actions.
	 * @return array Modified bulk actions.
	 */
	public static function register_bulk_actions( $actions ) {
		$actions['fair_audience_set_author'] = __( 'Set Photo Author', 'fair-audience' );
		return $actions;
	}

	/**
	 * Handle bulk action redirect.
	 *
	 * @param string $redirect_url Redirect URL.
	 * @param string $action       Action name.
	 * @param array  $post_ids     Selected post IDs.
	 * @return string Modified redirect URL.
	 */
	public static function handle_bulk_action( $redirect_url, $action, $post_ids ) {
		if ( 'fair_audience_set_author' !== $action ) {
			return $redirect_url;
		}

		if ( empty( $post_ids ) ) {
			return $redirect_url;
		}

		// Filter to only include attachments.
		$attachment_ids = array_filter(
			$post_ids,
			function ( $id ) {
				return 'attachment' === get_post_type( $id );
			}
		);

		if ( empty( $attachment_ids ) ) {
			return $redirect_url;
		}

		// Redirect to batch assignment page.
		return admin_url(
			'admin.php?page=fair-audience-batch-assign&attachments=' . implode( ',', $attachment_ids ) .
			'&_wpnonce=' . wp_create_nonce( 'fair_audience_batch_assign' )
		);
	}

	/**
	 * Register hidden admin page for batch assignment.
	 */
	public static function register_batch_page() {
		add_submenu_page(
			'', // Hidden page.
			__( 'Set Photo Author', 'fair-audience' ),
			__( 'Set Photo Author', 'fair-audience' ),
			'upload_files',
			'fair-audience-batch-assign',
			array( __CLASS__, 'render_batch_page' )
		);
	}

	/**
	 * Handle form submission early, before headers are sent.
	 */
	public static function handle_form_submission() {
		// Check if we're on our page and form was submitted.
		if ( ! isset( $_GET['page'] ) || 'fair-audience-batch-assign' !== $_GET['page'] ) {
			return;
		}

		if ( ! isset( $_POST['fair_audience_batch_submit'] ) ) {
			return;
		}

		// Verify nonce.
		if ( ! isset( $_POST['fair_audience_batch_nonce'] ) ||
			! wp_verify_nonce( $_POST['fair_audience_batch_nonce'], 'fair_audience_batch_assign_submit' ) ) {
			wp_die( esc_html__( 'Security check failed.', 'fair-audience' ) );
		}

		// Check capability.
		if ( ! current_user_can( 'upload_files' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'fair-audience' ) );
		}

		// Get participant ID.
		$participant_id = isset( $_POST['participant_id'] ) ? absint( $_POST['participant_id'] ) : 0;

		if ( ! $participant_id ) {
			wp_die( esc_html__( 'Please select an author.', 'fair-audience' ) );
		}

		// Verify participant exists.
		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( $participant_id );
		if ( ! $participant ) {
			wp_die( esc_html__( 'Invalid author selected.', 'fair-audience' ) );
		}

		// Get attachment IDs from form.
		$attachments_param = isset( $_POST['attachment_ids'] ) ? sanitize_text_field( $_POST['attachment_ids'] ) : '';
		$attachment_ids    = array_filter( array_map( 'absint', explode( ',', $attachments_param ) ) );

		if ( empty( $attachment_ids ) ) {
			wp_die( esc_html__( 'No photos to assign.', 'fair-audience' ) );
		}

		// Assign photos to author.
		$repository = new PhotoParticipantRepository();
		$assigned   = 0;

		foreach ( $attachment_ids as $attachment_id ) {
			// Verify attachment exists.
			if ( 'attachment' !== get_post_type( $attachment_id ) ) {
				continue;
			}

			$repository->set_author( $attachment_id, $participant_id );
			++$assigned;
		}

		// Redirect back to media library with success message.
		$redirect_url = add_query_arg(
			array(
				'fair_audience_batch_assigned' => $assigned,
				'fair_audience_batch_author'   => $participant_id,
			),
			admin_url( 'upload.php' )
		);

		wp_safe_redirect( $redirect_url );
		exit;
	}

	/**
	 * Render the batch assignment page.
	 */
	public static function render_batch_page() {
		// Verify nonce.
		if ( ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( $_GET['_wpnonce'], 'fair_audience_batch_assign' ) ) {
			wp_die( esc_html__( 'Security check failed.', 'fair-audience' ) );
		}

		// Check capability.
		if ( ! current_user_can( 'upload_files' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'fair-audience' ) );
		}

		// Get attachment IDs.
		$attachments_param = isset( $_GET['attachments'] ) ? sanitize_text_field( $_GET['attachments'] ) : '';
		$attachment_ids    = array_filter( array_map( 'absint', explode( ',', $attachments_param ) ) );

		if ( empty( $attachment_ids ) ) {
			wp_die( esc_html__( 'No photos selected.', 'fair-audience' ) );
		}

		// Get participants for dropdown.
		$repository   = new ParticipantRepository();
		$participants = $repository->get_all( 'surname', 'ASC' );

		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Set Photo Author', 'fair-audience' ); ?></h1>

			<form method="post">
				<?php wp_nonce_field( 'fair_audience_batch_assign_submit', 'fair_audience_batch_nonce' ); ?>
				<input type="hidden" name="attachment_ids" value="<?php echo esc_attr( implode( ',', $attachment_ids ) ); ?>" />

				<p>
					<?php
					echo esc_html(
						sprintf(
							/* translators: %d: number of photos */
							_n(
								'%d photo selected:',
								'%d photos selected:',
								count( $attachment_ids ),
								'fair-audience'
							),
							count( $attachment_ids )
						)
					);
					?>
				</p>

				<div style="display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; max-height: 300px; overflow-y: auto; padding: 10px; background: #f0f0f1; border-radius: 4px;">
					<?php foreach ( $attachment_ids as $attachment_id ) : ?>
						<?php
						$thumb_url = wp_get_attachment_image_url( $attachment_id, 'thumbnail' );
						$title     = get_the_title( $attachment_id );
						?>
						<div style="text-align: center;">
							<?php if ( $thumb_url ) : ?>
								<img src="<?php echo esc_url( $thumb_url ); ?>" alt="<?php echo esc_attr( $title ); ?>" style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px;" />
							<?php else : ?>
								<div style="width: 80px; height: 80px; background: #ddd; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
									<span class="dashicons dashicons-format-image"></span>
								</div>
							<?php endif; ?>
						</div>
					<?php endforeach; ?>
				</div>

				<table class="form-table">
					<tr>
						<th scope="row">
							<label for="fair_audience_participant_id"><?php esc_html_e( 'Author', 'fair-audience' ); ?></label>
						</th>
						<td>
							<select name="participant_id" id="fair_audience_participant_id" required>
								<option value=""><?php esc_html_e( '— Select Author —', 'fair-audience' ); ?></option>
								<?php foreach ( $participants as $participant ) : ?>
									<option value="<?php echo esc_attr( $participant->id ); ?>">
										<?php echo esc_html( $participant->surname . ', ' . $participant->name ); ?>
									</option>
								<?php endforeach; ?>
							</select>
							<p class="description">
								<?php esc_html_e( 'All selected photos will be attributed to this author.', 'fair-audience' ); ?>
							</p>
						</td>
					</tr>
				</table>

				<p class="submit">
					<a href="<?php echo esc_url( admin_url( 'upload.php' ) ); ?>" class="button">
						<?php esc_html_e( 'Cancel', 'fair-audience' ); ?>
					</a>
					<button type="submit" name="fair_audience_batch_submit" class="button button-primary">
						<?php esc_html_e( 'Set Author', 'fair-audience' ); ?>
					</button>
				</p>
			</form>
		</div>
		<?php
	}

	/**
	 * Show admin notices after batch assignment.
	 */
	public static function show_admin_notices() {
		if ( ! isset( $_GET['fair_audience_batch_assigned'] ) ) {
			return;
		}

		$assigned       = absint( $_GET['fair_audience_batch_assigned'] );
		$participant_id = isset( $_GET['fair_audience_batch_author'] ) ? absint( $_GET['fair_audience_batch_author'] ) : 0;

		if ( $assigned > 0 && $participant_id ) {
			$participant_repo = new ParticipantRepository();
			$participant      = $participant_repo->get_by_id( $participant_id );

			if ( $participant ) {
				$author_name = $participant->name . ' ' . $participant->surname;
				$message     = sprintf(
					/* translators: 1: number of photos, 2: author name */
					_n(
						'%1$d photo assigned to "%2$s".',
						'%1$d photos assigned to "%2$s".',
						$assigned,
						'fair-audience'
					),
					$assigned,
					$author_name
				);

				printf(
					'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
					esc_html( $message )
				);
			}
		}
	}
}
