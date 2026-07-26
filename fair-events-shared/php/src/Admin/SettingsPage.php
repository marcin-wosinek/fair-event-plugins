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
	 * Register the submenu page under Settings.
	 *
	 * @return void
	 */
	public static function register_page() {
		add_options_page(
			'Fair Event Plugins',
			'Fair Event Plugins',
			'manage_options',
			self::PAGE_SLUG,
			array( __CLASS__, 'render' )
		);
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
					'section'       => 'general',
					'section_title' => '',
					'type'          => 'checkbox',
					'label'         => '',
					'description'   => '',
					'value'         => false,
					'locked'        => false,
					'locked_note'   => '',
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
	 * - A field id absent from `$posted_ids` (e.g. its plugin was deactivated
	 *   between page load and submit) is skipped entirely — its option is
	 *   left untouched.
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
	 * Process a submitted form: compute updates and write them, grouping all
	 * key changes for the same option into a single update_option() call.
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

		$updates = self::build_updates( $fields, $posted_ids, $checked_ids );

		foreach ( $updates as $option => $values ) {
			$existing = get_option( $option, array() );
			if ( ! is_array( $existing ) ) {
				$existing = array();
			}

			update_option( $option, array_merge( $existing, $values ) );
		}

		return $updates;
	}

	/**
	 * Render the settings page, handling the POST save first.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have sufficient permissions to access this page.' );
		}

		$saved = false;
		if ( isset( $_POST[ self::NONCE_FIELD ] ) && check_admin_referer( self::NONCE_ACTION, self::NONCE_FIELD ) ) {
			self::save( self::collect_fields(), wp_unslash( $_POST ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
			$saved = true;
		}

		// Re-collect after saving so the form reflects the values just written.
		$fields = self::collect_fields();

		self::render_form( $fields, $saved );
	}

	/**
	 * Render the form markup for a set of fields.
	 *
	 * @param array $fields Normalized field descriptors.
	 * @param bool  $saved  Whether a save just happened (shows a success notice).
	 * @return void
	 */
	private static function render_form( array $fields, $saved ) {
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
			<h1>Fair Event Plugins</h1>
			<?php if ( $saved ) : ?>
				<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
			<?php endif; ?>

			<?php if ( empty( $sections ) ) : ?>
				<p>No shared settings are available yet.</p>
			<?php else : ?>
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
											<?php endif; ?>
										</td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					<?php endforeach; ?>

					<?php submit_button(); ?>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}
}
