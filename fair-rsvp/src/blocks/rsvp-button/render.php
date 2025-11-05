<?php
/**
 * Render callback for the RSVP button block
 *
 * @package FairRsvp
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 */

defined( 'WPINC' ) || die;

// Get current post/event ID.
$event_id = get_the_ID();

// Check if user is logged in.
$is_logged_in = is_user_logged_in();
$user_id      = get_current_user_id();

// Get respond before deadline from attributes.
$respond_before = $attributes['respondBefore'] ?? '';

// Resolve dynamic dates if fair-events plugin is active.
if ( ! empty( $respond_before ) && function_exists( 'fair_events_resolve_date' ) ) {
	$respond_before = fair_events_resolve_date( $respond_before, $event_id );
}

// Check if deadline has passed.
$deadline_passed = false;
if ( ! empty( $respond_before ) ) {
	try {
		$deadline_time = new DateTime( $respond_before );
		$deadline_time->setTimezone( wp_timezone() );
		$current_time = current_datetime();

		if ( $current_time >= $deadline_time ) {
			$deadline_passed = true;
		}
	} catch ( Exception $e ) {
		// If date parsing fails, assume no deadline.
		$deadline_passed = false;
	}
}

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                => 'fair-rsvp-button',
		'data-respond-before'  => esc_attr( $respond_before ),
		'data-deadline-passed' => $deadline_passed ? 'true' : 'false',
	)
);

// Initialize RSVP data.
$current_rsvp = null;

// If user is logged in, check for existing RSVP.
if ( $is_logged_in && $event_id ) {
	global $wpdb;
	$table_name = $wpdb->prefix . 'fair_rsvp';

	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
	$current_rsvp = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$table_name} WHERE event_id = %d AND user_id = %d",
			$event_id,
			$user_id
		),
		ARRAY_A
	);
}

$current_status = $current_rsvp ? $current_rsvp['rsvp_status'] : '';

?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( $deadline_passed ) : ?>
		<!-- Deadline has passed -->
		<div class="fair-rsvp-closed-message">
			<p><?php echo esc_html__( 'RSVPs for this event are now closed.', 'fair-rsvp' ); ?></p>
		</div>
	<?php elseif ( ! $is_logged_in ) : ?>
		<!-- Not logged in -->
		<div class="fair-rsvp-login-message">
			<p><?php echo esc_html__( 'Please log in to RSVP for this event.', 'fair-rsvp' ); ?></p>
			<a href="<?php echo esc_url( wp_login_url( get_permalink() ) ); ?>" class="fair-rsvp-login-button">
				<?php echo esc_html__( 'Log In', 'fair-rsvp' ); ?>
			</a>
		</div>
	<?php else : ?>
		<!-- Logged in - show RSVP form -->
		<div class="fair-rsvp-form-container" data-event-id="<?php echo esc_attr( $event_id ); ?>">
			<form class="fair-rsvp-form">
				<div class="fair-rsvp-options">
					<label class="fair-rsvp-option">
						<input
							type="radio"
							name="rsvp_status"
							value="yes"
							<?php checked( $current_status, 'yes' ); ?>
						/>
						<span><?php echo esc_html__( 'Yes', 'fair-rsvp' ); ?></span>
					</label>

					<label class="fair-rsvp-option">
						<input
							type="radio"
							name="rsvp_status"
							value="maybe"
							<?php checked( $current_status, 'maybe' ); ?>
						/>
						<span><?php echo esc_html__( 'Maybe', 'fair-rsvp' ); ?></span>
					</label>

					<label class="fair-rsvp-option">
						<input
							type="radio"
							name="rsvp_status"
							value="no"
							<?php checked( $current_status, 'no' ); ?>
						/>
						<span><?php echo esc_html__( 'No', 'fair-rsvp' ); ?></span>
					</label>
				</div>

				<button type="submit" class="fair-rsvp-submit-button">
					<?php echo esc_html__( 'Update RSVP', 'fair-rsvp' ); ?>
				</button>

				<div class="fair-rsvp-message" style="display: none;"></div>
			</form>

			<?php if ( $current_rsvp ) : ?>
				<p class="fair-rsvp-current-status">
					<?php
					// Translate the status value.
					$status_translations = array(
						'yes'   => __( 'Yes', 'fair-rsvp' ),
						'no'    => __( 'No', 'fair-rsvp' ),
						'maybe' => __( 'Maybe', 'fair-rsvp' ),
					);
					$translated_status   = isset( $status_translations[ $current_status ] ) ? $status_translations[ $current_status ] : ucfirst( $current_status );

					echo esc_html__( 'Your current RSVP: ', 'fair-rsvp' ) . '<strong>' . esc_html( $translated_status ) . '</strong>';
					?>
				</p>
			<?php endif; ?>
		</div>
	<?php endif; ?>
</div>
