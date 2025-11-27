<?php
/**
 * Render callback for the RSVP button block
 *
 * @package FairRsvp
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

// Get current post/event ID.
$event_id = get_the_ID();

// Check if user is logged in.
$is_logged_in = is_user_logged_in();
$user_id      = get_current_user_id();

// Get RSVP question and respond before deadline from attributes.
$rsvp_question  = $attributes['rsvpQuestion'] ?? '';
$respond_before = $attributes['respondBefore'] ?? '';

// Resolve dynamic dates if fair-events plugin is active.
if ( ! empty( $respond_before ) && function_exists( 'fair_events_resolve_date' ) ) {
	$respond_before = fair_events_resolve_date( $respond_before, $event_id );
}

// Get attendance permissions.
$attendance  = $attributes['attendance'] ?? array();
$permission  = \FairRsvp\Utils\AttendanceHelper::get_user_permission( $user_id, $is_logged_in, $attendance, $event_id );
$is_allowed  = \FairRsvp\Utils\AttendanceHelper::is_allowed( $permission );
$is_expected = \FairRsvp\Utils\AttendanceHelper::is_expected( $permission );

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
		'data-rsvp-question'   => esc_attr( $rsvp_question ),
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

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
	$current_rsvp = $wpdb->get_row(
		$wpdb->prepare(
			'SELECT * FROM %i WHERE event_id = %d AND user_id = %d',
			$table_name,
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
		<?php
		// Check if anonymous users are allowed to RSVP.
		$anonymous_permission = isset( $attendance['anonymous'] ) ? (int) $attendance['anonymous'] : 0;
		$allow_anonymous      = $anonymous_permission >= 1;
		?>

		<?php if ( $allow_anonymous ) : ?>
			<!-- Not logged in but anonymous allowed - show name/email form -->
			<?php if ( $is_expected ) : ?>
				<div class="fair-rsvp-invited-banner">
					<p><?php echo esc_html__( "You're invited to this event!", 'fair-rsvp' ); ?></p>
				</div>
			<?php endif; ?>
			<?php if ( ! empty( $rsvp_question ) ) : ?>
				<h2 class="fair-rsvp-question"><?php echo esc_html( $rsvp_question ); ?></h2>
			<?php endif; ?>
			<div class="fair-rsvp-form-container fair-rsvp-anonymous-form" data-event-id="<?php echo esc_attr( $event_id ); ?>" data-anonymous="true">
				<form class="fair-rsvp-form">
					<div class="fair-rsvp-user-info">
						<div class="fair-rsvp-field">
							<label for="fair-rsvp-name-<?php echo esc_attr( $event_id ); ?>">
								<?php echo esc_html__( 'Your Name', 'fair-rsvp' ); ?> <span class="required">*</span>
							</label>
							<input
								type="text"
								id="fair-rsvp-name-<?php echo esc_attr( $event_id ); ?>"
								name="rsvp_name"
								class="fair-rsvp-input"
								required
								placeholder="<?php echo esc_attr__( 'Enter your name', 'fair-rsvp' ); ?>"
							/>
						</div>
						<div class="fair-rsvp-field">
							<label for="fair-rsvp-email-<?php echo esc_attr( $event_id ); ?>">
								<?php echo esc_html__( 'Your Email', 'fair-rsvp' ); ?> <span class="required">*</span>
							</label>
							<input
								type="email"
								id="fair-rsvp-email-<?php echo esc_attr( $event_id ); ?>"
								name="rsvp_email"
								class="fair-rsvp-input"
								required
								placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-rsvp' ); ?>"
							/>
						</div>
					</div>

					<div class="fair-rsvp-options">
						<label class="fair-rsvp-option">
							<input
								type="radio"
								name="rsvp_status"
								value="yes"
								required
							/>
							<span><?php echo esc_html__( 'Yes', 'fair-rsvp' ); ?></span>
						</label>

						<label class="fair-rsvp-option">
							<input
								type="radio"
								name="rsvp_status"
								value="maybe"
							/>
							<span><?php echo esc_html__( 'Maybe', 'fair-rsvp' ); ?></span>
						</label>

						<label class="fair-rsvp-option">
							<input
								type="radio"
								name="rsvp_status"
								value="no"
							/>
							<span><?php echo esc_html__( 'No', 'fair-rsvp' ); ?></span>
						</label>
					</div>

					<button type="submit" class="fair-rsvp-submit-button">
						<?php echo esc_html__( 'Submit RSVP', 'fair-rsvp' ); ?>
					</button>

					<div class="fair-rsvp-message" style="display: none;"></div>
				</form>
			</div>
		<?php else : ?>
			<!-- Not logged in and anonymous not allowed - show login prompt -->
			<div class="fair-rsvp-login-message">
				<p><?php echo esc_html__( 'Please log in to RSVP for this event.', 'fair-rsvp' ); ?></p>
				<a href="<?php echo esc_url( wp_login_url( get_permalink() ) ); ?>" class="fair-rsvp-login-button">
					<?php echo esc_html__( 'Log In', 'fair-rsvp' ); ?>
				</a>
			</div>
		<?php endif; ?>
	<?php elseif ( ! $is_allowed ) : ?>
		<!-- Logged in but not allowed to RSVP -->
		<div class="fair-rsvp-not-allowed-message">
			<p><?php echo esc_html__( 'This event is invite-only.', 'fair-rsvp' ); ?></p>
		</div>
	<?php else : ?>
		<!-- Allowed and logged in - show RSVP form -->
		<?php if ( $is_expected ) : ?>
			<div class="fair-rsvp-invited-banner">
				<p><?php echo esc_html__( "You're invited to this event!", 'fair-rsvp' ); ?></p>
			</div>
		<?php endif; ?>
		<?php if ( ! empty( $rsvp_question ) ) : ?>
			<h2 class="fair-rsvp-question"><?php echo esc_html( $rsvp_question ); ?></h2>
		<?php endif; ?>
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

			<?php if ( $is_expected && ! $deadline_passed ) : ?>
				<!-- Invite a Friend button for expected users -->
				<div class="fair-rsvp-invite-section">
					<button type="button" class="fair-rsvp-invite-button" data-event-id="<?php echo esc_attr( $event_id ); ?>">
						<?php echo esc_html__( 'Invite a Friend', 'fair-rsvp' ); ?>
					</button>
				</div>
			<?php endif; ?>
		</div>
	<?php endif; ?>

	<?php if ( current_user_can( 'edit_post', $event_id ) ) : ?>
		<!-- Attendance check link for editors -->
		<div class="fair-rsvp-attendance-link-wrapper <?php echo $deadline_passed ? 'deadline-passed' : ''; ?>">
			<a
				href="<?php echo esc_url( get_permalink( $event_id ) . 'attendance/' ); ?>"
				class="fair-rsvp-attendance-link <?php echo $deadline_passed ? 'attendance-link-prominent' : 'attendance-link-small'; ?>"
			>
				<?php echo $deadline_passed ? esc_html__( '📋 Check Attendance List', 'fair-rsvp' ) : esc_html__( '📋 Attendance', 'fair-rsvp' ); ?>
			</a>
		</div>
	<?php endif; ?>
</div>
