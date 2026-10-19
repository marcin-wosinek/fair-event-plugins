<?php
/**
 * Copy Event Admin Page
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

defined( 'ABSPATH' ) || die;

use FairEvents\Helpers\EventTiming;
use FairEvents\Services\EventCopyService;

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
		$event_date_id = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;
		if ( ! $event_date_id ) {
			wp_die( esc_html__( 'A valid event date is required.', 'fair-events' ) );
		}
		if ( ! isset( $_POST['copy_event_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['copy_event_nonce'] ) ), 'copy_fair_event_submit_' . $event_date_id ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-events' ) );
		}

		$source = EventCopyService::resolve_source( $event_date_id );
		if ( is_wp_error( $source ) ) {
			wp_die( esc_html( $source->get_error_message() ) );
		}

		// Get form data.
		$new_title   = isset( $_POST['event_title'] ) ? sanitize_text_field( wp_unslash( $_POST['event_title'] ) ) : '';
		$date_option = isset( $_POST['date_option'] ) ? sanitize_text_field( wp_unslash( $_POST['date_option'] ) ) : '';
		$custom_date = isset( $_POST['custom_date'] ) ? sanitize_text_field( wp_unslash( $_POST['custom_date'] ) ) : '';
		$start_time  = isset( $_POST['start_time'] ) ? sanitize_text_field( wp_unslash( $_POST['start_time'] ) ) : '';
		$end_time    = isset( $_POST['end_time'] ) ? sanitize_text_field( wp_unslash( $_POST['end_time'] ) ) : '';

		// Validate title.
		if ( empty( $new_title ) ) {
			wp_die( esc_html__( 'Event title is required.', 'fair-events' ) );
		}

		// Calculate new dates based on selected option.
		$new_timing = $this->calculate_new_timing( $source['master']->get_timing(), $date_option, $custom_date, $start_time, $end_time );
		$result     = ( new EventCopyService() )->copy( $source, $new_title, $new_timing );
		if ( is_wp_error( $result ) ) {
			wp_die( esc_html( $result->get_error_message() ) );
		}

		$redirect = $result['post_id']
			? get_edit_post_link( $result['post_id'], 'raw' )
			: admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . $result['event_date_id'] );
		wp_safe_redirect( $redirect );
		exit;
	}

	/**
	 * Render the copy event page
	 *
	 * @return void
	 */
	public function render() {
		$event_date_id = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;
		if ( ! $event_date_id ) {
			wp_die( esc_html__( 'A valid event date is required.', 'fair-events' ) );
		}

		// Verify nonce.
		if ( ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ), 'copy_fair_event_' . $event_date_id ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-events' ) );
		}

		$source = EventCopyService::resolve_source( $event_date_id );
		if ( is_wp_error( $source ) ) {
			wp_die( esc_html( $source->get_error_message() ) );
		}

		$this->render_form( $source );
	}

	/**
	 * Calculate the copy's timing based on the date option
	 *
	 * Keeps the source's calendar-day span and all-day flag. Either time may
	 * be left empty, also one the source has, and then stays missing, so the
	 * copy never gets an invented time.
	 *
	 * @param array  $source_timing Source canonical timing (see EventTiming).
	 * @param string $date_option   Date offset option ('week', 'custom').
	 * @param string $custom_date   Custom date value (YYYY-MM-DD).
	 * @param string $start_time    Submitted start time (HH:MM), or empty.
	 * @param string $end_time      Submitted end time (HH:MM), or empty.
	 * @return array Canonical timing of the copy.
	 */
	private function calculate_new_timing( array $source_timing, $date_option, $custom_date, $start_time, $end_time ) {
		switch ( $date_option ) {
			case 'week':
				$new_start_date = EventTiming::add_days( $source_timing['start_date'], 7 );
				break;

			case 'custom':
				if ( empty( $custom_date ) ) {
					wp_die( esc_html__( 'Custom date is required.', 'fair-events' ) );
				}
				$new_start_date = EventTiming::normalize_date( $custom_date );
				if ( ! is_string( $new_start_date ) ) {
					wp_die( esc_html__( 'Enter a valid custom date.', 'fair-events' ) );
				}
				break;

			default:
				wp_die( esc_html__( 'Invalid date option selected.', 'fair-events' ) );
		}

		$timing = EventTiming::for_date( $source_timing, $new_start_date );

		if ( ! $source_timing['all_day'] ) {
			foreach ( array(
				'start_time' => $start_time,
				'end_time'   => $end_time,
			) as $key => $value ) {
				if ( '' !== $value && ! $this->is_valid_time( $value ) ) {
					wp_die( esc_html__( 'Enter valid start and end times.', 'fair-events' ) );
				}
				$timing[ $key ] = '' === $value ? null : $value . ':00';
			}
		}

		if ( EventTiming::validate( $timing ) ) {
			wp_die( esc_html__( 'End date and time must be after the start date and time.', 'fair-events' ) );
		}

		return $timing;
	}

	/**
	 * Check that a time uses the native time input's HH:MM format.
	 *
	 * @param string $time Time value.
	 * @return bool
	 */
	private function is_valid_time( $time ) {
		return 1 === preg_match( '/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time );
	}

	/**
	 * Render the copy event form
	 *
	 * @param array $source Resolved event source.
	 * @return void
	 */
	private function render_form( $source ) {
		$event_dates   = $source['master'];
		$original_post = $source['post'];
		$event_id      = $original_post ? $original_post->ID : 0;
		$title         = $original_post ? $original_post->post_title : $event_dates->title;
		$location      = $event_id ? get_post_meta( $event_id, 'event_location', true ) : $event_dates->address;
		$source_url    = $event_id
			? get_edit_post_link( $event_id, 'raw' )
			: admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . $event_dates->id );

		// Get featured image.
		$thumbnail_id  = $event_id && post_type_supports( $original_post->post_type, 'thumbnail' ) ? get_post_thumbnail_id( $event_id ) : 0;
		$thumbnail_url = $thumbnail_id ? get_the_post_thumbnail_url( $event_id, 'thumbnail' ) : '';
		$thumbnail_alt = $thumbnail_id ? get_post_meta( $thumbnail_id, '_wp_attachment_image_alt', true ) : '';

		// Get categories and tags.
		$categories      = $event_id && is_object_in_taxonomy( $original_post->post_type, 'category' ) ? wp_get_post_terms( $event_id, 'category', array( 'fields' => 'names' ) ) : array();
		$tags            = $event_id && is_object_in_taxonomy( $original_post->post_type, 'post_tag' ) ? wp_get_post_terms( $event_id, 'post_tag', array( 'fields' => 'names' ) ) : array();
		$categories_list = ! is_wp_error( $categories ) && ! empty( $categories ) ? implode( ', ', $categories ) : '';
		$tags_list       = ! is_wp_error( $tags ) && ! empty( $tags ) ? implode( ', ', $tags ) : '';

		// Format dates for display.
		$start_date          = '';
		$end_date            = '';
		$default_custom_date = '';
		$duration_seconds    = 0;
		$start_time          = '';
		$end_time            = '';
		$timing              = $event_dates->get_timing();
		$has_end_date        = $timing['end_date'] !== $timing['start_date'] || null !== $timing['end_time'];
		$start_value         = $timing['start_date'] . ( null !== $timing['start_time'] ? 'T' . $timing['start_time'] : '' );
		$end_value           = $has_end_date ? $timing['end_date'] . ( null !== $timing['end_time'] ? 'T' . $timing['end_time'] : '' ) : '';
		if ( $event_dates ) {
			$start_dt = new \DateTime( $timing['start_date'] . ' ' . ( $timing['start_time'] ?? '00:00:00' ) );
			$end_dt   = new \DateTime( $timing['end_date'] . ' ' . ( $timing['end_time'] ?? '00:00:00' ) );

			// Calculate duration: whole days for all-day events, otherwise only
			// when both times are known.
			if ( $timing['all_day'] || ( null !== $timing['start_time'] && null !== $timing['end_time'] ) ) {
				$duration_seconds = $end_dt->getTimestamp() - $start_dt->getTimestamp();
			}
			$start_time = null !== $timing['start_time'] ? substr( $timing['start_time'], 0, 5 ) : '';
			$end_time   = null !== $timing['end_time'] ? substr( $timing['end_time'], 0, 5 ) : '';

			// Calculate default custom date (2 weeks from original start).
			$default_custom_date = EventTiming::add_days( $timing['start_date'], 14 );

			$start_date = $start_dt->format( '' !== $start_time ? 'F j, Y g:i a' : 'F j, Y' );
			$end_date   = $has_end_date ? $end_dt->format( '' !== $end_time ? 'F j, Y g:i a' : 'F j, Y' ) : '';
		}
		?>
		<div class="wrap">
		<h1><?php esc_html_e( 'Copy Event', 'fair-events' ); ?>: <a href="<?php echo esc_url( $source_url ); ?>"><?php echo esc_html( $title ); ?></a>
</h1>

			<?php if ( 'master' === $event_dates->occurrence_type ) : ?>
				<div class="notice notice-info inline"><p><?php esc_html_e( 'This copies the entire recurring series.', 'fair-events' ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="">
				<?php wp_nonce_field( 'copy_fair_event_submit_' . $event_dates->id, 'copy_event_nonce' ); ?>

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
								value="<?php echo esc_attr( $title . ' ' . __( '(Copy)', 'fair-events' ) ); ?>"
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
									<?php esc_html_e( 'Select the new start date. The event day span will be preserved.', 'fair-events' ); ?>
								</p>
							</div>
						</td>
					</tr>
					<?php if ( ! $event_dates->all_day ) : ?>
					<tr>
						<th scope="row"><label for="start_time"><?php esc_html_e( 'Start time (optional)', 'fair-events' ); ?></label></th>
						<td><input type="time" id="start_time" name="start_time" value="<?php echo esc_attr( $start_time ); ?>" aria-describedby="copy-event-times-help" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="end_time"><?php esc_html_e( 'End time (optional)', 'fair-events' ); ?></label></th>
						<td>
							<input type="time" id="end_time" name="end_time" value="<?php echo esc_attr( $end_time ); ?>" aria-describedby="copy-event-times-help" />
							<p class="description" id="copy-event-times-help"><?php esc_html_e( 'Leave a time empty until it is known. Visitors see only the times you enter.', 'fair-events' ); ?></p>
						</td>
					</tr>
					<?php endif; ?>
				</table>

				<!-- Section 3: Summary Preview -->
					<h2><?php esc_html_e( 'What Will Be Created', 'fair-events' ); ?></h2>
					<table class="form-table">
						<tr>
							<th scope="row"><?php esc_html_e( 'Title', 'fair-events' ); ?></th>
							<td><strong id="summary-title"><?php echo esc_html( $title . ' ' . __( '(Copy)', 'fair-events' ) ); ?></strong></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Start Date', 'fair-events' ); ?></th>
							<td id="summary-start-date"><?php echo esc_html( $start_date ); ?></td>
						</tr>
						<?php if ( $has_end_date ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'End Date', 'fair-events' ); ?></th>
							<td id="summary-end-date"><?php echo esc_html( $end_date ); ?></td>
						</tr>
						<?php endif; ?>
						<?php if ( $duration_seconds > 0 ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Duration', 'fair-events' ); ?></th>
							<td id="summary-duration"></td>
						</tr>
						<?php endif; ?>
						<?php if ( $location ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Location', 'fair-events' ); ?></th>
							<td><?php echo esc_html( $location ); ?></td>
						</tr>
						<?php endif; ?>
						<?php if ( $thumbnail_url ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Featured Image', 'fair-events' ); ?></th>
							<td><img src="<?php echo esc_url( $thumbnail_url ); ?>" alt="<?php echo esc_attr( $thumbnail_alt ); ?>" style="max-width: 150px; height: auto;" /></td>
						</tr>
						<?php endif; ?>
						<?php if ( $categories_list ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Categories', 'fair-events' ); ?></th>
							<td><?php echo esc_html( $categories_list ); ?></td>
						</tr>
						<?php endif; ?>
						<?php if ( $tags_list ) : ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Tags', 'fair-events' ); ?></th>
							<td><?php echo esc_html( $tags_list ); ?></td>
						</tr>
						<?php endif; ?>
					</table>
					<p class="description">
					<?php echo esc_html( $event_id ? __( 'The copied post will be created as a draft with its reusable event details.', 'fair-events' ) : __( 'A new calendar-only event will be created with its reusable event details.', 'fair-events' ) ); ?>
					</p>

				<p class="submit">
					<input
						type="submit"
						name="copy_event_submit"
						id="submit"
						class="button button-primary"
						value="<?php esc_attr_e( 'Create Copy', 'fair-events' ); ?>"
					/>
					<a href="<?php echo esc_url( $source_url ); ?>" class="button">
						<?php esc_html_e( 'Cancel', 'fair-events' ); ?>
					</a>
				</p>
			</form>

			<script>
			(function() {
				// Configuration from PHP
				const config = {
					originalStartDate: <?php echo wp_json_encode( $start_value ); ?>,
					originalEndDate: <?php echo wp_json_encode( $end_value ); ?>,
					durationSeconds: <?php echo absint( $duration_seconds ); ?>,
					isAllDay: <?php echo $event_dates && $event_dates->all_day ? 'true' : 'false'; ?>,
					defaultCustomDate: <?php echo wp_json_encode( $default_custom_date ); ?>
				};

				// DOM elements
				const titleInput = document.getElementById('event_title');
				const customRadio = document.getElementById('date_option_custom');
				const customField = document.getElementById('custom_date_field');
				const customInput = document.getElementById('custom_date');
				const startTimeInput = document.getElementById('start_time');
				const endTimeInput = document.getElementById('end_time');
				const allRadios = document.querySelectorAll('input[name="date_option"]');
				const summaryTitle = document.getElementById('summary-title');
				const summaryStartDate = document.getElementById('summary-start-date');
				const summaryEndDate = document.getElementById('summary-end-date');
				const summaryDuration = document.getElementById('summary-duration');

				// Utility functions
				function formatDuration(seconds) {
					if (seconds === 0) return '';

					const hours = Math.floor(seconds / 3600);
					const days = Math.floor(hours / 24);
					const weeks = Math.floor(days / 7);

					if (weeks > 0 && days % 7 === 0) {
						return weeks === 1 ? '1 week' : weeks + ' weeks';
					}
					if (days > 0 && hours % 24 === 0) {
						return days === 1 ? '1 day' : days + ' days';
					}
					if (hours > 0 && seconds % 3600 === 0) {
						return hours === 1 ? '1 hour' : hours + ' hours';
					}

					const minutes = Math.floor(seconds / 60);
					if (minutes > 0) {
						if (hours > 0) {
							return hours + 'h ' + (minutes % 60) + 'm';
						}
						return minutes === 1 ? '1 minute' : minutes + ' minutes';
					}

					return seconds + ' seconds';
				}

				function formatDate(date, isAllDay) {
					if (!date) return '';
					const options = isAllDay || !date.hasTime
						? { year: 'numeric', month: 'long', day: 'numeric' }
						: { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };

					return date.toLocaleString('en-US', options);
				}

				function parseLocalDate(value) {
					if (!value) return null;
					const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
					if (!parts) return null;
					return new Date(
						Number(parts[1]),
						Number(parts[2]) - 1,
						Number(parts[3]),
						Number(parts[4] || 0),
						Number(parts[5] || 0),
						Number(parts[6] || 0)
					);
				}

				function applyTime(date, input) {
					if (!date) return date;
					date.hasTime = Boolean(input && input.value);
					if (!date.hasTime) {
						date.setHours(0, 0, 0, 0);
						return date;
					}
					const [hours, minutes] = input.value.split(':').map(Number);
					date.setHours(hours, minutes, 0, 0);
					return date;
				}

				function calculateNewDates() {
					if (!config.originalStartDate) return null;

					const originalStart = parseLocalDate(config.originalStartDate);
					const originalEnd = parseLocalDate(config.originalEndDate);
					if (!originalStart) return null;
					let newStart = new Date(originalStart);
					const dayOffset = originalEnd
						? Math.round((new Date(originalEnd.getFullYear(), originalEnd.getMonth(), originalEnd.getDate()) - new Date(originalStart.getFullYear(), originalStart.getMonth(), originalStart.getDate())) / 86400000)
						: 0;

					// Apply date offset based on selected radio
					const selectedOption = document.querySelector('input[name="date_option"]:checked').value;

					if (selectedOption === 'week') {
						newStart.setDate(newStart.getDate() + 7);
					} else if (selectedOption === 'custom' && customInput.value) {
						newStart = parseLocalDate(customInput.value);
					}
					if (!newStart) return null;
					if (!config.isAllDay) applyTime(newStart, startTimeInput);

					// Calculate new end date
					let newEnd = null;
					if (originalEnd) {
						newEnd = new Date(newStart);
						newEnd.setDate(newEnd.getDate() + dayOffset);
						if (!config.isAllDay) applyTime(newEnd, endTimeInput);
					}

					return { start: newStart, end: newEnd };
				}

				// Update summary dynamically
				function updateSummary() {
					// Update title
					if (summaryTitle && titleInput) {
						summaryTitle.textContent = titleInput.value;
					}

					// Update dates
					const newDates = calculateNewDates();
					if (newDates) {
						if (summaryStartDate) {
							summaryStartDate.textContent = formatDate(newDates.start, config.isAllDay);
						}
						if (summaryEndDate && newDates.end) {
							summaryEndDate.textContent = formatDate(newDates.end, config.isAllDay);
						}
					}

					// Update duration
					if (summaryDuration && newDates && newDates.end && (config.isAllDay || (newDates.start.hasTime && newDates.end.hasTime))) {
						summaryDuration.textContent = formatDuration(Math.max(0, (newDates.end - newDates.start) / 1000));
					}
				}

				function toggleCustomField() {
					if (customRadio.checked) {
						customField.style.display = 'block';
						customInput.required = true;
						// Set default date (2 weeks later) if input is empty
						if (!customInput.value && config.defaultCustomDate) {
							customInput.value = config.defaultCustomDate;
						}
					} else {
						customField.style.display = 'none';
						customInput.required = false;
					}
					updateSummary();
				}

				// Event listeners
				if (titleInput) {
					titleInput.addEventListener('input', updateSummary);
				}

				allRadios.forEach(function(radio) {
					radio.addEventListener('change', toggleCustomField);
				});

				if (customInput) {
					customInput.addEventListener('change', updateSummary);
				}
				if (startTimeInput) {
					startTimeInput.addEventListener('input', updateSummary);
				}
				if (endTimeInput) {
					endTimeInput.addEventListener('input', updateSummary);
				}

				// Initialize
				toggleCustomField();
				updateSummary();
			})();
			</script>
		</div>
		<?php
	}
}
