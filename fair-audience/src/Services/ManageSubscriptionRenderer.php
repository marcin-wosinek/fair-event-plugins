<?php
/**
 * Manage Subscription Renderer
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Prints the public subscription-management page for the outcome of
 * {@see ManageSubscriptionPage::handle()}.
 *
 * Without JavaScript every form still works: the script only keeps the
 * related controls in step and opens the deletion confirmation as a dialog.
 */
class ManageSubscriptionRenderer {

	/**
	 * Print the whole page.
	 *
	 * @param array $page Page state from ManageSubscriptionPage::handle().
	 * @return void
	 */
	public static function render( array $page ) {
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
		?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html( $site_name ); ?></title>
		<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<div class="fair-audience-subscription-container">
	<div class="fair-audience-subscription-box">
		<?php
		if ( ManageSubscriptionPage::VIEW_INVALID === $page['view'] ) {
			self::render_invalid( $page );
		} else {
			self::render_profile( $page );
		}
		?>
	</div>
</div>
		<?php wp_footer(); ?>
</body>
</html>
		<?php
	}

	/**
	 * Print the page for a link that cannot be used.
	 *
	 * @param array $page Page state.
	 * @return void
	 */
	private static function render_invalid( array $page ) {
		?>
		<div class="fair-audience-error-container">
			<div class="fair-audience-error-icon">&#10007;</div>
			<h1 class="fair-audience-subscription-title">
				<?php echo esc_html__( 'Invalid Link', 'fair-audience' ); ?>
			</h1>
			<p class="fair-audience-subscription-message error">
				<?php echo esc_html( $page['message'] ); ?>
			</p>
			<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
				<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
			</a>
		</div>
		<?php
	}

	/**
	 * Print the page for an authorized participant.
	 *
	 * @param array $page Page state.
	 * @return void
	 */
	private static function render_profile( array $page ) {
		$participant = $page['participant'];
		?>
		<h1 class="fair-audience-subscription-title">
			<?php echo esc_html__( 'Manage Your Subscription', 'fair-audience' ); ?>
		</h1>
		<?php if ( ! empty( $participant->email ) ) : ?>
			<p class="fair-audience-subscription-subtitle">
				<?php echo esc_html( $participant->email ); ?>
			</p>
		<?php endif; ?>

		<?php if ( ! empty( $page['message'] ) ) : ?>
			<div class="fair-audience-subscription-message <?php echo esc_attr( $page['message_type'] ); ?>" role="<?php echo 'error' === $page['message_type'] ? 'alert' : 'status'; ?>">
				<?php echo esc_html( $page['message'] ); ?>
			</div>
		<?php endif; ?>

		<?php
		if ( ManageSubscriptionPage::VIEW_CONFIRM_DELETE === $page['view'] ) {
			echo '<div class="fair-audience-delete-confirmation">';
			self::render_delete_confirmation( $page, false );
			echo '</div>';
			return;
		}

		if ( ManageSubscriptionPage::VIEW_MANAGE === $page['view'] ) {
			self::render_preferences( $page );
			self::render_home_link();
			self::render_delete_section( $page );
			return;
		}

		self::render_home_link();
	}

	/**
	 * Print the email preferences form.
	 *
	 * @param array $page Page state.
	 * @return void
	 */
	private static function render_preferences( array $page ) {
		$participant = $page['participant'];
		$profile     = $page['preferences']['email_profile'];
		$profiles    = array(
			'marketing' => array(
				__( 'All emails', 'fair-audience' ),
				__( 'Receive event invitations, photos, polls, and other updates.', 'fair-audience' ),
			),
			'minimal'   => array(
				__( 'Essential emails only', 'fair-audience' ),
				__( 'Only receive emails about events you signed up for (photos, polls, confirmations). No promotional emails.', 'fair-audience' ),
			),
		);
		?>
		<form method="post" data-fair-audience-preferences>
			<div class="fair-audience-subscription-options">
				<?php foreach ( $profiles as $value => list( $title, $description ) ) : ?>
					<label class="fair-audience-subscription-option <?php echo $value === $profile ? 'selected' : ''; ?>">
						<input type="radio" name="email_profile" value="<?php echo esc_attr( $value ); ?>" <?php checked( $profile, $value ); ?>>
						<span class="fair-audience-subscription-option-content">
							<span class="fair-audience-subscription-option-title"><?php echo esc_html( $title ); ?></span>
							<span class="fair-audience-subscription-option-description"><?php echo esc_html( $description ); ?></span>
						</span>
					</label>
				<?php endforeach; ?>
			</div>

			<?php
			if ( $page['weekly']['enabled'] ) {
				self::render_weekly( $page );
			}
			self::render_categories( (int) $participant->id );
			?>

			<button type="submit" class="fair-audience-subscription-submit">
				<?php echo esc_html__( 'Save Preferences', 'fair-audience' ); ?>
			</button>
		</form>
		<?php
	}

	/**
	 * Print the weekly email preferences: the overall switch, then which
	 * event feeds.
	 *
	 * @param array $page Page state.
	 * @return void
	 */
	private static function render_weekly( array $page ) {
		$weekly       = $page['weekly'];
		$preferences  = $page['preferences'];
		$is_marketing = 'marketing' === $preferences['email_profile'];
		$receives     = $preferences['weekly_summary'];
		$mode         = $preferences['weekly_feed_mode'];
		$selected     = $preferences['weekly_feeds'];
		$show_feeds   = $weekly['feeds_available'] && ( $weekly['feeds'] || WeeklyFeeds::MODE_SELECTED === $mode );
		?>
		<div class="fair-audience-subscription-weekly-summary" id="fair-audience-weekly-summary-wrap" data-fair-audience-weekly <?php echo $is_marketing ? '' : 'hidden'; ?>>
			<label class="fair-audience-subscription-category-label">
				<input
					type="checkbox"
					name="weekly_summary"
					id="fair-audience-weekly-summary"
					data-fair-audience-weekly-summary
					<?php checked( $receives ); ?>
					<?php disabled( ! $is_marketing ); ?>
				/>
				<?php echo esc_html__( 'Weekly summary of upcoming events', 'fair-audience' ); ?>
			</label>

			<?php if ( $show_feeds ) : ?>
				<fieldset class="fair-audience-subscription-feeds" data-fair-audience-weekly-feeds <?php disabled( ! $is_marketing || ! $receives ); ?>>
					<legend class="fair-audience-subscription-feeds-title">
						<?php echo esc_html__( 'Which weekly emails do you want?', 'fair-audience' ); ?>
					</legend>
					<label class="fair-audience-subscription-category-label">
						<input type="radio" name="weekly_feed_mode" value="<?php echo esc_attr( WeeklyFeeds::MODE_ALL ); ?>" <?php checked( $mode, WeeklyFeeds::MODE_ALL ); ?>>
						<span>
							<?php echo esc_html__( 'All weekly emails', 'fair-audience' ); ?>
							<span class="fair-audience-subscription-hint"><?php echo esc_html__( 'Includes event feeds added later.', 'fair-audience' ); ?></span>
						</span>
					</label>
					<label class="fair-audience-subscription-category-label">
						<input type="radio" name="weekly_feed_mode" value="<?php echo esc_attr( WeeklyFeeds::MODE_SELECTED ); ?>" <?php checked( $mode, WeeklyFeeds::MODE_SELECTED ); ?>>
						<span><?php echo esc_html__( 'Only the event feeds I choose', 'fair-audience' ); ?></span>
					</label>

					<fieldset class="fair-audience-subscription-feed-list" data-fair-audience-feed-list <?php disabled( WeeklyFeeds::MODE_SELECTED !== $mode ); ?>>
						<legend class="screen-reader-text"><?php echo esc_html__( 'Event feeds', 'fair-audience' ); ?></legend>
						<?php foreach ( $weekly['feeds'] as $feed ) : ?>
							<label class="fair-audience-subscription-category-label">
								<input
									type="checkbox"
									name="weekly_feeds[]"
									value="<?php echo esc_attr( (string) $feed['id'] ); ?>"
									<?php checked( in_array( (int) $feed['id'], $selected, true ) ); ?>
								/>
								<?php echo esc_html( $feed['name'] ); ?>
							</label>
						<?php endforeach; ?>
						<p class="fair-audience-subscription-hint">
							<?php echo esc_html__( 'If you choose no event feeds, you receive no weekly emails.', 'fair-audience' ); ?>
						</p>
					</fieldset>

					<?php self::render_unavailable_feeds( $weekly ); ?>
				</fieldset>
			<?php elseif ( ! $weekly['feeds_available'] && WeeklyFeeds::MODE_SELECTED === $mode ) : ?>
				<p class="fair-audience-subscription-hint">
					<?php echo esc_html__( 'Your choice of event feeds is kept, but it cannot be changed right now.', 'fair-audience' ); ?>
				</p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Explain chosen feeds that are not sent at the moment.
	 *
	 * @param array $weekly Weekly state of the page.
	 * @return void
	 */
	private static function render_unavailable_feeds( array $weekly ) {
		if ( $weekly['unavailable'] ) {
			$names = implode( ', ', array_column( $weekly['unavailable'], 'name' ) );
			?>
			<p class="fair-audience-subscription-hint">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %s: comma-separated names of event feeds */
						_n(
							'You also chose %s, which is not sent at the moment. Your choice is kept for when it returns.',
							'You also chose %s, which are not sent at the moment. Your choice is kept for when they return.',
							count( $weekly['unavailable'] ),
							'fair-audience'
						),
						$names
					)
				);
				?>
			</p>
			<?php
		}

		if ( $weekly['deleted'] > 0 ) {
			?>
			<p class="fair-audience-subscription-hint">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %d: number of event feeds */
						_n(
							'%d event feed you chose no longer exists.',
							'%d event feeds you chose no longer exist.',
							$weekly['deleted'],
							'fair-audience'
						),
						$weekly['deleted']
					)
				);
				?>
			</p>
			<?php
		}
	}

	/**
	 * Print the announcement categories, when the site offers any.
	 *
	 * @param int $participant_id Participant ID.
	 * @return void
	 */
	private static function render_categories( int $participant_id ) {
		$category_ids = get_option( 'fair_audience_mailing_category_ids', array() );
		if ( empty( $category_ids ) ) {
			return;
		}

		$categories = get_terms(
			array(
				'taxonomy'   => 'category',
				'hide_empty' => false,
				'include'    => array_map( 'intval', $category_ids ),
				'orderby'    => 'name',
				'order'      => 'ASC',
			)
		);
		if ( is_wp_error( $categories ) || empty( $categories ) ) {
			return;
		}

		$chosen = ( new \FairAudience\Database\ParticipantCategoryRepository() )->get_category_ids_by_participant( $participant_id );
		?>
		<div class="fair-audience-subscription-categories">
			<h2 class="fair-audience-subscription-categories-title">
				<?php echo esc_html__( 'I want to receive updates about:', 'fair-audience' ); ?>
			</h2>
			<?php foreach ( $categories as $category ) : ?>
				<label class="fair-audience-subscription-category-label">
					<input
						type="checkbox"
						name="mailing_categories[]"
						value="<?php echo esc_attr( $category->term_id ); ?>"
						<?php checked( in_array( (int) $category->term_id, $chosen, true ) ); ?>
					/>
					<?php echo esc_html( $category->name ); ?>
				</label>
			<?php endforeach; ?>
		</div>
		<?php
	}

	/**
	 * Print the link back to the site.
	 *
	 * @return void
	 */
	private static function render_home_link() {
		?>
		<div class="fair-audience-subscription-footer">
			<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fair-audience-subscription-link">
				<?php echo esc_html__( 'Return to Homepage', 'fair-audience' ); ?>
			</a>
		</div>
		<?php
	}

	/**
	 * Print the "Delete My Data" section with its dialog.
	 *
	 * @param array $page Page state.
	 * @return void
	 */
	private static function render_delete_section( array $page ) {
		?>
		<div class="fair-audience-subscription-delete-section">
			<h2 class="fair-audience-subscription-delete-title">
				<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
			</h2>
			<p class="fair-audience-subscription-delete-description">
				<?php echo esc_html__( 'Delete your contact details and preferences from your profile. Some records, such as tickets and payments, are kept. This cannot be undone.', 'fair-audience' ); ?>
			</p>
			<form method="post" data-fair-audience-delete-trigger>
				<input type="hidden" name="delete_my_data" value="1">
				<button type="submit" class="fair-audience-subscription-delete-button" aria-haspopup="dialog">
					<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
				</button>
			</form>
			<dialog
				class="fair-audience-delete-dialog"
				aria-labelledby="fair-audience-delete-confirmation-title"
				aria-describedby="fair-audience-delete-confirmation-description"
				data-fair-audience-delete-dialog
				hidden
			>
				<?php self::render_delete_confirmation( $page, true ); ?>
			</dialog>
		</div>
		<?php
	}

	/**
	 * Print the deletion confirmation: whose data, what changes, what stays,
	 * and the two actions. Shown in the dialog, and as a page when the dialog
	 * cannot be used.
	 *
	 * @param array $page      Page state.
	 * @param bool  $in_dialog Whether it is printed inside the dialog.
	 * @return void
	 */
	private static function render_delete_confirmation( array $page, bool $in_dialog ) {
		$participant = $page['participant'];
		$scope       = ManageSubscriptionPage::deletion_scope();
		?>
		<form method="post" class="fair-audience-delete-confirmation-form">
			<h2 class="fair-audience-delete-confirmation-title" id="fair-audience-delete-confirmation-title">
				<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
			</h2>
			<div id="fair-audience-delete-confirmation-description">
				<p>
					<?php
					if ( ! empty( $participant->email ) ) {
						echo esc_html(
							sprintf(
								/* translators: %s: email address of the profile */
								__( 'Delete the personal data stored for %s?', 'fair-audience' ),
								$participant->email
							)
						);
					} else {
						echo esc_html__( 'Delete the personal data stored for this profile?', 'fair-audience' );
					}
					?>
				</p>
				<p class="fair-audience-delete-confirmation-list-title">
					<?php echo esc_html__( 'What is deleted:', 'fair-audience' ); ?>
				</p>
				<ul>
					<?php foreach ( $scope['changed'] as $sentence ) : ?>
						<li><?php echo esc_html( $sentence ); ?></li>
					<?php endforeach; ?>
				</ul>
				<p class="fair-audience-delete-confirmation-list-title">
					<?php echo esc_html__( 'What is kept:', 'fair-audience' ); ?>
				</p>
				<ul>
					<?php foreach ( $scope['kept'] as $sentence ) : ?>
						<li><?php echo esc_html( $sentence ); ?></li>
					<?php endforeach; ?>
				</ul>
				<p class="fair-audience-delete-confirmation-warning">
					<?php echo esc_html__( 'This cannot be undone.', 'fair-audience' ); ?>
				</p>
			</div>
			<input type="hidden" name="confirm_delete_my_data" value="1">
			<input type="hidden" name="delete_confirmation" value="<?php echo esc_attr( $page['confirmation_proof'] ); ?>">
			<div class="fair-audience-delete-confirmation-actions">
				<?php if ( $in_dialog ) : ?>
					<button type="button" class="fair-audience-delete-confirmation-cancel" data-fair-audience-delete-cancel autofocus>
						<?php echo esc_html__( 'Cancel', 'fair-audience' ); ?>
					</button>
				<?php else : ?>
					<a class="fair-audience-delete-confirmation-cancel" href="<?php echo esc_url( ManageSubscriptionToken::get_url( (int) $participant->id ) ); ?>">
						<?php echo esc_html__( 'Cancel', 'fair-audience' ); ?>
					</a>
				<?php endif; ?>
				<button type="submit" class="fair-audience-delete-confirmation-submit" data-submitting-label="<?php echo esc_attr__( 'Deleting…', 'fair-audience' ); ?>">
					<?php echo esc_html__( 'Delete My Data', 'fair-audience' ); ?>
				</button>
			</div>
		</form>
		<?php
	}
}
