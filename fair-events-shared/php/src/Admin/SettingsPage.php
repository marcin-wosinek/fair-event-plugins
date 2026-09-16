<?php
/**
 * Central "Fair Event Plugins" settings screen under Settings.
 *
 * Plugins never call into this class directly — they push field descriptors
 * through the `fair_event_plugins_settings_fields` filter. That keeps the
 * extension point version-skew proof: only one copy of this class is ever
 * loaded (whichever active plugin's bundled copy PHP's autoloader resolves
 * first), and every other plugin's registered fields are plain arrays it can
 * read regardless of which version registered them.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Admin;

defined( 'WPINC' ) || die;

/**
 * Registers and renders the shared Settings → Fair Event Plugins screen.
 */
class SettingsPage {

	/**
	 * Menu/page slug.
	 */
	const PAGE_SLUG = 'fair-event-plugins';

	/**
	 * Nonce action for the save form.
	 */
	const NONCE_ACTION = 'fair_event_plugins_settings_save';

	/**
	 * Nonce field name.
	 */
	const NONCE_FIELD = 'fair_event_plugins_settings_nonce';

	/**
	 * Shared reason textarea field name. Shown once for the whole form (not
	 * per field) and only required when a field marked `requires_reason`
	 * actually changes value.
	 */
	const REASON_FIELD = 'fair_event_plugins_reason';

	/**
	 * Whether boot() already ran in this request. Guards against every active
	 * plugin's call to boot() registering its own `admin_menu` hook, which
	 * would otherwise add duplicate submenu entries.
	 *
	 * @var bool
	 */
	private static $booted = false;

	/**
	 * Register the admin_menu hook. Safe to call from every plugin — only the
	 * first call in a given request does anything.
	 *
	 * @return void
	 */
	public static function boot() {
		if ( self::$booted ) {
			return;
		}
		self::$booted = true;

		add_action( 'admin_menu', array( __CLASS__, 'register_page' ) );
	}

	/**
	 * Register the submenu page under Settings, and the load-hook that
	 * handles the save POST before headers are sent.
	 *
	 * Bails when no plugin has registered any field — there is nothing to
	 * show, so the page (and its "no settings yet" state) simply don't exist.
	 *
	 * @return void
	 */
	public static function register_page() {
		if ( empty( self::collect_fields() ) ) {
			return;
		}

		// "Fair Event Plugins" is a brand name, left untranslated by design
		// (see the Decisions section in PHP_PATTERNS.md).
		$hook = add_options_page(
			'Fair Event Plugins',
			'Fair Event Plugins',
			'manage_options',
			self::PAGE_SLUG,
			array( __CLASS__, 'render' )
		);

		if ( $hook ) {
			add_action( "load-{$hook}", array( __CLASS__, 'handle_post' ) );
		}
	}

	/**
	 * Collect and normalize field descriptors from every registered plugin.
	 *
	 * @return array<int,array<string,mixed>> Normalized field descriptors.
	 */
	public static function collect_fields() {
		$fields = apply_filters( 'fair_event_plugins_settings_fields', array() );
		if ( ! is_array( $fields ) ) {
			return array();
		}

		$out = array();
		foreach ( $fields as $field ) {
			if ( ! is_array( $field ) || empty( $field['id'] ) || empty( $field['option'] ) || empty( $field['key'] ) ) {
				continue;
			}

			$out[] = wp_parse_args(
				$field,
				array(
					'section'         => 'general',
					'section_title'   => '',
					'type'            => 'checkbox',
					'label'           => '',
					'description'     => '',
					'value'           => false,
					'locked'          => false,
					'locked_note'     => '',
					'requires_reason' => false,
				)
			);
		}

		return $out;
	}

	/**
	 * Pure computation of what to write to each option, given the registered
	 * fields and the submitted form state. No WordPress option calls happen
	 * here, so this is directly unit-testable.
	 *
	 * - `$posted_ids` is a form-integrity allowlist, not a deactivation guard:
	 *   it is populated from hidden inputs rendered while every field's
	 *   plugin was still active, so a truncated or forged POST can't flip a
	 *   field that was never rendered. A field id absent from `$posted_ids`
	 *   is skipped entirely — its option is left untouched. Deactivation
	 *   safety instead comes from `$fields` itself being re-collected at save
	 *   time, so a since-deactivated plugin's descriptor is simply gone.
	 * - A `locked` field is never written from the UI, even if present in
	 *   `$posted_ids`.
	 * - Any other posted field id not present in `$checked_ids` means the
	 *   checkbox was unchecked, so it resolves to `false`.
	 *
	 * @param array $fields      Normalized field descriptors from collect_fields().
	 * @param array $posted_ids  Field ids present in the hidden allowlist input.
	 * @param array $checked_ids Field ids whose checkbox was checked.
	 * @return array<string,array<string,bool>> Map of option name => [ key => bool ] to write.
	 */
	public static function build_updates( array $fields, array $posted_ids, array $checked_ids ) {
		$updates = array();

		foreach ( $fields as $field ) {
			if ( ! in_array( $field['id'], $posted_ids, true ) ) {
				continue;
			}

			if ( ! empty( $field['locked'] ) ) {
				continue;
			}

			$option = $field['option'];
			$key    = $field['key'];

			if ( ! isset( $updates[ $option ] ) ) {
				$updates[ $option ] = array();
			}

			$updates[ $option ][ $key ] = in_array( $field['id'], $checked_ids, true );
		}

		return $updates;
	}

	/**
	 * Whether the submitted reason satisfies every reason-requiring field
	 * that would actually change value.
	 *
	 * A reason is only demanded when it's needed: a field marked
	 * `requires_reason` that is absent from the post, locked, or unchanged
	 * from its current value never forces a reason on an otherwise
	 * unrelated save (e.g. another plugin's unmarked checkbox).
	 *
	 * @param array  $fields      Normalized field descriptors from collect_fields().
	 * @param array  $posted_ids  Field ids present in the hidden allowlist input.
	 * @param array  $checked_ids Field ids whose checkbox was checked.
	 * @param string $reason      Submitted (already-sanitized) reason.
	 * @return bool True when the save may proceed.
	 */
	public static function reason_satisfied( array $fields, array $posted_ids, array $checked_ids, $reason ) {
		if ( '' !== trim( (string) $reason ) ) {
			return true;
		}

		foreach ( $fields as $field ) {
			if ( empty( $field['requires_reason'] ) || ! empty( $field['locked'] ) ) {
				continue;
			}
			if ( ! in_array( $field['id'], $posted_ids, true ) ) {
				continue;
			}
			$new_value = in_array( $field['id'], $checked_ids, true );
			if ( $new_value !== (bool) $field['value'] ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Process a submitted form: compute updates and write them, grouping all
	 * key changes for the same option into a single update_option() call.
	 * Fires `fair_event_plugins_setting_changed` for each key whose value
	 * actually changed, so a registering plugin can record its own audit
	 * entry — this class has no knowledge of any specific plugin's audit log.
	 *
	 * @param array $fields Normalized field descriptors from collect_fields().
	 * @param array $posted Unslashed $_POST data.
	 * @return array<string,array<string,bool>> The updates that were written.
	 */
	public static function save( array $fields, array $posted ) {
		$posted_ids = array();
		if ( isset( $posted['fair_event_plugins_fields'] ) && is_array( $posted['fair_event_plugins_fields'] ) ) {
			$posted_ids = array_map( 'sanitize_text_field', $posted['fair_event_plugins_fields'] );
		}

		$checked_ids = array();
		if ( isset( $posted['fair_event_plugins_values'] ) && is_array( $posted['fair_event_plugins_values'] ) ) {
			$checked_ids = array_map( 'sanitize_text_field', array_keys( $posted['fair_event_plugins_values'] ) );
		}

		$reason = isset( $posted[ self::REASON_FIELD ] ) ? sanitize_textarea_field( $posted[ self::REASON_FIELD ] ) : '';

		$updates = self::build_updates( $fields, $posted_ids, $checked_ids );

		foreach ( $updates as $option => $values ) {
			$existing = get_option( $option, array() );
			if ( ! is_array( $existing ) ) {
				$existing = array();
			}

			foreach ( $values as $key => $new_value ) {
				$old_value = array_key_exists( $key, $existing ) ? $existing[ $key ] : null;
				if ( $old_value === $new_value ) {
					continue;
				}
				do_action( 'fair_event_plugins_setting_changed', $option, $key, $old_value, $new_value, $reason );
			}

			update_option( $option, array_merge( $existing, $values ) );
		}

		return $updates;
	}

	/**
	 * Handle the save POST on `load-{$hook}`, before any headers are sent, so
	 * a redirect back to the page is possible. Runs once per submit, ahead of
	 * the `render()` GET that follows the redirect.
	 *
	 * @return void
	 */
	public static function handle_post() {
		if ( ! isset( $_POST[ self::NONCE_FIELD ] ) ) {
			return;
		}

		check_admin_referer( self::NONCE_ACTION, self::NONCE_FIELD );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.' ), 403 );
		}

		$posted = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$fields = self::collect_fields();

		$posted_ids  = ( isset( $posted['fair_event_plugins_fields'] ) && is_array( $posted['fair_event_plugins_fields'] ) )
			? array_map( 'sanitize_text_field', $posted['fair_event_plugins_fields'] )
			: array();
		$checked_ids = ( isset( $posted['fair_event_plugins_values'] ) && is_array( $posted['fair_event_plugins_values'] ) )
			? array_map( 'sanitize_text_field', array_keys( $posted['fair_event_plugins_values'] ) )
			: array();
		$reason      = isset( $posted[ self::REASON_FIELD ] ) ? sanitize_textarea_field( $posted[ self::REASON_FIELD ] ) : '';

		if ( ! self::reason_satisfied( $fields, $posted_ids, $checked_ids, $reason ) ) {
			// Reject the whole submit rather than silently drop just the
			// reason-requiring field — a partial save here would look like
			// a random unchecked box to the admin.
			wp_safe_redirect( add_query_arg( 'fair_event_plugins_error', 'reason_required', menu_page_url( self::PAGE_SLUG, false ) ) );
			exit;
		}

		self::save( $fields, $posted );

		wp_safe_redirect( add_query_arg( 'settings-updated', 'true', menu_page_url( self::PAGE_SLUG, false ) ) );
		exit;
	}

	/**
	 * Render the settings page.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.' ), 403 );
		}

		// Read-only display flags reflecting the redirect from handle_post(),
		// which already verified the nonce before writing anything — nothing
		// is processed or written here.
		$saved  = isset( $_GET['settings-updated'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$error  = isset( $_GET['fair_event_plugins_error'] ) ? sanitize_text_field( wp_unslash( $_GET['fair_event_plugins_error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$fields = self::collect_fields();

		self::render_form( $fields, $saved, $error );
	}

	/**
	 * Render the form markup for a set of fields.
	 *
	 * @param array  $fields Normalized field descriptors.
	 * @param bool   $saved  Whether a save just happened (shows a success notice).
	 * @param string $error  Error code from a rejected submit, or ''.
	 * @return void
	 */
	private static function render_form( array $fields, $saved, $error = '' ) {
		$requires_reason = false;
		foreach ( $fields as $field ) {
			if ( ! empty( $field['requires_reason'] ) ) {
				$requires_reason = true;
				break;
			}
		}

		$sections = array();
		foreach ( $fields as $field ) {
			$section = $field['section'];
			if ( ! isset( $sections[ $section ] ) ) {
				$sections[ $section ] = array(
					'title'  => $field['section_title'] ? $field['section_title'] : $section,
					'fields' => array(),
				);
			}
			$sections[ $section ]['fields'][] = $field;
		}

		foreach ( $sections as $key => $section ) {
			usort(
				$section['fields'],
				static function ( $a, $b ) {
					return strcasecmp( $a['label'], $b['label'] );
				}
			);
			$sections[ $key ] = $section;
		}
		?>
		<div class="wrap">
			<?php // "Fair Event Plugins" is a brand name, left untranslated by design. ?>
			<h1>Fair Event Plugins</h1>
			<?php if ( $saved ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.' ); ?></p></div>
			<?php endif; ?>
			<?php if ( 'reason_required' === $error ) : ?>
				<div class="notice notice-error"><p><?php esc_html_e( 'A reason is required to change a setting marked "reason required" below. Nothing was saved.', 'fair-events-shared' ); ?></p></div>
			<?php endif; ?>

			<form method="post">
				<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD ); ?>
				<?php foreach ( $fields as $field ) : ?>
					<input type="hidden" name="fair_event_plugins_fields[]" value="<?php echo esc_attr( $field['id'] ); ?>" />
				<?php endforeach; ?>

				<?php foreach ( $sections as $section ) : ?>
					<h2><?php echo esc_html( $section['title'] ); ?></h2>
					<table class="form-table" role="presentation">
						<tbody>
							<?php foreach ( $section['fields'] as $field ) : ?>
								<tr>
									<th scope="row"><?php echo esc_html( $field['label'] ); ?></th>
									<td>
										<label>
											<input
												type="checkbox"
												name="fair_event_plugins_values[<?php echo esc_attr( $field['id'] ); ?>]"
												value="1"
												<?php checked( (bool) $field['value'] ); ?>
												<?php disabled( (bool) $field['locked'] ); ?>
											/>
											<?php echo esc_html( $field['description'] ); ?>
										</label>
										<?php if ( $field['locked'] && $field['locked_note'] ) : ?>
											<p class="description"><?php echo esc_html( $field['locked_note'] ); ?></p>
										<?php elseif ( ! empty( $field['requires_reason'] ) ) : ?>
											<p class="description"><?php esc_html_e( 'Changing this requires a reason below.', 'fair-events-shared' ); ?></p>
										<?php endif; ?>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				<?php endforeach; ?>

				<?php if ( $requires_reason ) : ?>
					<h2><?php esc_html_e( 'Reason for this change', 'fair-events-shared' ); ?></h2>
					<p>
						<label for="<?php echo esc_attr( self::REASON_FIELD ); ?>" class="screen-reader-text"><?php esc_html_e( 'Reason for this change', 'fair-events-shared' ); ?></label>
						<textarea id="<?php echo esc_attr( self::REASON_FIELD ); ?>" name="<?php echo esc_attr( self::REASON_FIELD ); ?>" rows="2" class="large-text"></textarea>
					</p>
					<p class="description"><?php esc_html_e( 'Required when changing a setting marked "reason required" above.', 'fair-events-shared' ); ?></p>
				<?php endif; ?>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
