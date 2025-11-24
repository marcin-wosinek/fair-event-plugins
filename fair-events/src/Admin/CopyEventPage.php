<?php
/**
 * Copy Event Admin Page
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

use FairEvents\Models\EventDates;
use FairEvents\PostTypes\Event;

/**
 * Copy Event Page Class
 *
 * Handles the copy event admin page where users can duplicate
 * an event with date adjustments before creation.
 */
class CopyEventPage {

	/**
	 * Handle form submission and create the new event
	 *
	 * @return void
	 */
	public function handle_submission() {
		// Check permissions.
		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die( esc_html__( 'You do not have permission to create events.', 'fair-events' ) );
		}

		// Verify nonce.
		if ( ! isset( $_POST['copy_event_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['copy_event_nonce'] ) ), 'copy_fair_event_submit' ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-events' ) );
		}

		// Get and validate event ID.
		$event_id = isset( $_GET['event_id'] ) ? absint( $_GET['event_id'] ) : 0;
		if ( ! $event_id ) {
			wp_die( esc_html__( 'Invalid event ID.', 'fair-events' ) );
		}

		// Get original event.
		$original_post = get_post( $event_id );
		if ( ! $original_post || Event::POST_TYPE !== $original_post->post_type ) {
			wp_die( esc_html__( 'Event not found.', 'fair-events' ) );
		}

		// Get form data.
		$new_title   = isset( $_POST['event_title'] ) ? sanitize_text_field( wp_unslash( $_POST['event_title'] ) ) : '';
		$date_option = isset( $_POST['date_option'] ) ? sanitize_text_field( wp_unslash( $_POST['date_option'] ) ) : '';
		$custom_date = isset( $_POST['custom_date'] ) ? sanitize_text_field( wp_unslash( $_POST['custom_date'] ) ) : '';

		// Validate title.
		if ( empty( $new_title ) ) {
			wp_die( esc_html__( 'Event title is required.', 'fair-events' ) );
		}

		// Get original event dates.
		$original_dates = EventDates::get_by_event_id( $event_id );
		if ( ! $original_dates ) {
			wp_die( esc_html__( 'Could not retrieve event dates.', 'fair-events' ) );
		}

		// Calculate new dates based on selected option.
		$new_dates = $this->calculate_new_dates( $original_dates, $date_option, $custom_date );

		// Create new post.
		$new_post_data = array(
			'post_title'   => $new_title,
			'post_content' => $original_post->post_content,
			'post_excerpt' => $original_post->post_excerpt,
			'post_type'    => Event::POST_TYPE,
			'post_status'  => 'draft',
			'post_author'  => get_current_user_id(),
		);

		$new_post_id = wp_insert_post( $new_post_data );

		if ( is_wp_error( $new_post_id ) ) {
			wp_die( esc_html__( 'Failed to create new event.', 'fair-events' ) );
		}

		// Copy event dates.
		EventDates::save(
			$new_post_id,
			$new_dates['start'],
			$new_dates['end'],
			$original_dates->all_day
		);

		// Copy location.
		$location = get_post_meta( $event_id, 'event_location', true );
		if ( $location ) {
			update_post_meta( $new_post_id, 'event_location', $location );
		}

		// Copy featured image.
		$thumbnail_id = get_post_thumbnail_id( $event_id );
		if ( $thumbnail_id ) {
			set_post_thumbnail( $new_post_id, $thumbnail_id );
		}

		// Copy taxonomies (categories & tags).
		$taxonomies = get_object_taxonomies( Event::POST_TYPE );
		foreach ( $taxonomies as $taxonomy ) {
			$terms = wp_get_object_terms( $event_id, $taxonomy, array( 'fields' => 'ids' ) );
			if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
				wp_set_object_terms( $new_post_id, $terms, $taxonomy );
			}
		}

		// Redirect to edit new event.
		wp_safe_redirect( admin_url( 'post.php?action=edit&post=' . $new_post_id ) );
		exit;
	}

	/**
	 * Render the copy event page
	 *
	 * @return void
	 */
	public function render() {
		// Check permissions.
		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die( esc_html__( 'You do not have permission to copy events.', 'fair-events' ) );
		}

		// Get and validate event ID.
		$event_id = isset( $_GET['event_id'] ) ? absint( $_GET['event_id'] ) : 0;
		if ( ! $event_id ) {
			wp_die( esc_html__( 'Invalid event ID.', 'fair-events' ) );
		}

		// Verify nonce.
		if ( ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'copy_fair_event_' . $event_id ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-events' ) );
		}

		// Get original event.
		$original_post = get_post( $event_id );
		if ( ! $original_post || Event::POST_TYPE !== $original_post->post_type ) {
			wp_die( esc_html__( 'Event not found.', 'fair-events' ) );
		}

		// Render the form.
		$this->render_form( $event_id, $original_post );
	}

	/**
	 * Calculate new dates based on date option
	 *
	 * @param object $original_dates Original event dates object.
	 * @param string $date_option    Date offset option ('week', 'custom').
	 * @param string $custom_date    Custom date value (YYYY-MM-DD).
	 * @return array Array with 'start' and 'end' datetime strings.
	 */
	private function calculate_new_dates( $original_dates, $date_option, $custom_date ) {
		$original_start = new \DateTime( $original_dates->start_datetime );
		$original_end   = $original_dates->end_datetime ? new \DateTime( $original_dates->end_datetime ) : null;

		// Calculate duration in seconds.
		$duration = 0;
		if ( $original_end ) {
			$duration = $original_end->getTimestamp() - $original_start->getTimestamp();
		}

		$new_start = clone $original_start;

		// Apply date offset.
		switch ( $date_option ) {
			case 'week':
				$new_start->modify( '+7 days' );
				break;

			case 'custom':
				if ( empty( $custom_date ) ) {
					wp_die( esc_html__( 'Custom date is required.', 'fair-events' ) );
				}

				// Parse custom date.
				$custom_datetime = new \DateTime( $custom_date );

				// If all-day event, use date only.
				if ( $original_dates->all_day ) {
					$new_start = new \DateTime( $custom_datetime->format( 'Y-m-d' ) );
				} else {
					// For timed events, preserve the time of day.
					$new_start = new \DateTime(
						$custom_datetime->format( 'Y-m-d' ) . ' ' . $original_start->format( 'H:i:s' )
					);
				}
				break;

			default:
				wp_die( esc_html__( 'Invalid date option selected.', 'fair-events' ) );
		}

		// Calculate new end date by adding duration.
		$new_end = null;
		if ( $original_end ) {
			$new_end = clone $new_start;
			$new_end->modify( '+' . $duration . ' seconds' );
		}

		// Format dates for storage.
		$start_format  = $original_dates->all_day ? 'Y-m-d' : 'Y-m-d\TH:i:s';
		$new_start_str = $new_start->format( $start_format );
		$new_end_str   = $new_end ? $new_end->format( $start_format ) : null;

		return array(
			'start' => $new_start_str,
			'end'   => $new_end_str,
		);
	}

	/**
	 * Render the copy event form
	 *
	 * @param int      $event_id      Event ID.
	 * @param \WP_Post $original_post Original post object.
	 * @return void
	 */
	private function render_form( $event_id, $original_post ) {
		// Get event data.
		$event_dates = EventDates::get_by_event_id( $event_id );
		$location    = get_post_meta( $event_id, 'event_location', true );

		// Format dates for display.
		$start_date          = '';
		$end_date            = '';
		$default_custom_date = '';
		if ( $event_dates ) {
			$start_dt = new \DateTime( $event_dates->start_datetime );
			$end_dt   = $event_dates->end_datetime ? new \DateTime( $event_dates->end_datetime ) : null;

			// Calculate default custom date (2 weeks from original start)
			$two_weeks_later = clone $start_dt;
			$two_weeks_later->modify( '+14 days' );
			$default_custom_date = $two_weeks_later->format( 'Y-m-d' );

			if ( $event_dates->all_day ) {
				$start_date = $start_dt->format( 'F j, Y' );
				$end_date   = $end_dt ? $end_dt->format( 'F j, Y' ) : '';
			} else {
				$start_date = $start_dt->format( 'F j, Y g:i a' );
				$end_date   = $end_dt ? $end_dt->format( 'F j, Y g:i a' ) : '';
			}
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Copy Event', 'fair-events' ); ?></h1>

			<div style="background: #fff; border: 1px solid #ccd0d4; padding: 20px; margin: 20px 0; max-width: 800px;">
				<h2><?php esc_html_e( 'Original Event', 'fair-events' ); ?></h2>
				<table class="form-table">
					<tr>
						<th scope="row"><?php esc_html_e( 'Title', 'fair-events' ); ?></th>
						<td><strong><?php echo esc_html( $original_post->post_title ); ?></strong></td>
					</tr>
					<?php if ( $start_date ) : ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'Start', 'fair-events' ); ?></th>
						<td><?php echo esc_html( $start_date ); ?></td>
					</tr>
					<?php endif; ?>
					<?php if ( $end_date ) : ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'End', 'fair-events' ); ?></th>
						<td><?php echo esc_html( $end_date ); ?></td>
					</tr>
					<?php endif; ?>
					<?php if ( $location ) : ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'Location', 'fair-events' ); ?></th>
						<td><?php echo esc_html( $location ); ?></td>
					</tr>
					<?php endif; ?>
				</table>
			</div>

			<form method="post" action="">
				<?php wp_nonce_field( 'copy_fair_event_submit', 'copy_event_nonce' ); ?>

				<table class="form-table">
					<tr>
						<th scope="row">
							<label for="event_title"><?php esc_html_e( 'New Event Title', 'fair-events' ); ?> <span class="required">*</span></label>
						</th>
						<td>
							<input
								type="text"
								id="event_title"
								name="event_title"
								value="<?php echo esc_attr( $original_post->post_title . ' ' . __( '(Copy)', 'fair-events' ) ); ?>"
								class="regular-text"
								required
							/>
						</td>
					</tr>

					<tr>
						<th scope="row">
							<?php esc_html_e( 'Event Date', 'fair-events' ); ?> <span class="required">*</span>
						</th>
						<td>
							<fieldset>
								<label>
									<input type="radio" name="date_option" value="week" checked />
									<?php esc_html_e( 'A week later', 'fair-events' ); ?>
								</label><br>
								<label>
									<input type="radio" name="date_option" value="custom" id="date_option_custom" />
									<?php esc_html_e( 'Custom date', 'fair-events' ); ?>
								</label>
							</fieldset>

							<div id="custom_date_field" style="margin-top: 10px; display: none;">
								<input
									type="date"
									id="custom_date"
									name="custom_date"
									class="regular-text"
									data-default-date="<?php echo esc_attr( $default_custom_date ); ?>"
								/>
								<p class="description">
									<?php esc_html_e( 'Select the new start date. The event duration and time will be preserved.', 'fair-events' ); ?>
								</p>
							</div>
						</td>
					</tr>
				</table>

				<p class="description">
					<?php esc_html_e( 'The new event will be created as a draft. All other event details (description, location, featured image, categories) will be copied from the original event.', 'fair-events' ); ?>
				</p>

				<p class="submit">
					<input
						type="submit"
						name="copy_event_submit"
						id="submit"
						class="button button-primary"
						value="<?php esc_attr_e( 'Create Copy', 'fair-events' ); ?>"
					/>
					<a href="<?php echo esc_url( admin_url( 'edit.php?post_type=fair_event' ) ); ?>" class="button">
						<?php esc_html_e( 'Cancel', 'fair-events' ); ?>
					</a>
				</p>
			</form>

			<script>
			(function() {
				const customRadio = document.getElementById('date_option_custom');
				const customField = document.getElementById('custom_date_field');
				const customInput = document.getElementById('custom_date');
				const allRadios = document.querySelectorAll('input[name="date_option"]');
				const defaultDate = customInput.getAttribute('data-default-date');

				function toggleCustomField() {
					if (customRadio.checked) {
						customField.style.display = 'block';
						customInput.required = true;
						// Set default date (2 weeks later) if input is empty
						if (!customInput.value && defaultDate) {
							customInput.value = defaultDate;
						}
					} else {
						customField.style.display = 'none';
						customInput.required = false;
					}
				}

				allRadios.forEach(function(radio) {
					radio.addEventListener('change', toggleCustomField);
				});

				toggleCustomField();
			})();
			</script>
		</div>
		<?php
	}
}
