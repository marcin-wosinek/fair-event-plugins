<?php
/**
 * Block registration hooks for Fair Form
 *
 * @package FairForm
 */

namespace FairForm\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress block registration for fair-form blocks.
 */
class BlockHooks {

	/**
	 * Fair Form block slugs; each is registered as fair-form/<slug> from
	 * build/blocks/<slug>.
	 *
	 * @var string[]
	 */
	const BLOCK_SLUGS = array(
		'fair-form',
		'fair-form-short-text',
		'fair-form-long-text',
		'fair-form-email',
		'fair-form-phone',
		'fair-form-url',
		'fair-form-date',
		'fair-form-datetime',
		'fair-form-select-one',
		'fair-form-multiselect',
		'fair-form-radio',
		'fair-form-option',
		'fair-form-file-upload',
		'fair-form-consent',
		'fair-form-conditional',
		'fair-form-mailing-signup',
	);

	/**
	 * Legacy block names mapped to their canonical names (#1161).
	 *
	 * The blocks were registered under the fair-audience namespace while the
	 * form feature lived in Fair Audience. Content saved since then uses those
	 * names, so they stay registered as hidden aliases of the canonical
	 * blocks; BlockNameMigration rewrites stored content to the canonical
	 * names. Keep the aliases: imports and restored revisions or backups can
	 * bring the legacy names back at any time. Block types added later have
	 * no legacy name.
	 *
	 * @var array<string, string>
	 */
	const LEGACY_NAMES = array(
		'fair-audience/fair-form'                => 'fair-form/fair-form',
		'fair-audience/fair-form-short-text'     => 'fair-form/fair-form-short-text',
		'fair-audience/fair-form-long-text'      => 'fair-form/fair-form-long-text',
		'fair-audience/fair-form-email'          => 'fair-form/fair-form-email',
		'fair-audience/fair-form-phone'          => 'fair-form/fair-form-phone',
		'fair-audience/fair-form-url'            => 'fair-form/fair-form-url',
		'fair-audience/fair-form-date'           => 'fair-form/fair-form-date',
		'fair-audience/fair-form-datetime'       => 'fair-form/fair-form-datetime',
		'fair-audience/fair-form-select-one'     => 'fair-form/fair-form-select-one',
		'fair-audience/fair-form-multiselect'    => 'fair-form/fair-form-multiselect',
		'fair-audience/fair-form-radio'          => 'fair-form/fair-form-radio',
		'fair-audience/fair-form-option'         => 'fair-form/fair-form-option',
		'fair-audience/fair-form-file-upload'    => 'fair-form/fair-form-file-upload',
		'fair-audience/fair-form-consent'        => 'fair-form/fair-form-consent',
		'fair-audience/fair-form-conditional'    => 'fair-form/fair-form-conditional',
		'fair-audience/fair-form-mailing-signup' => 'fair-form/fair-form-mailing-signup',
	);

	/**
	 * Constructor - registers WordPress hooks.
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Canonical name of a block, accepting a legacy Fair Form block name.
	 *
	 * @param string|null $block_name Block name.
	 * @return string|null The canonical name, or the name unchanged when it is
	 *                     not a legacy Fair Form block name.
	 */
	public static function canonical_name( $block_name ) {
		if ( ! is_string( $block_name ) ) {
			return $block_name;
		}

		return self::LEGACY_NAMES[ $block_name ] ?? $block_name;
	}

	/**
	 * Register all fair-form block types and their legacy aliases.
	 *
	 * WordPress derives the script handles from the block names
	 * (fair-form-fair-form-*), while the text domain is Fair Form's own.
	 *
	 * @return void
	 */
	public function register_blocks() {
		$translations_path = \FairForm\Core\Features::script_translations_path();

		foreach ( self::BLOCK_SLUGS as $slug ) {
			$block_type = register_block_type( FAIR_FORM_DIR . 'build/blocks/' . $slug );
			if ( ! $block_type ) {
				continue;
			}

			foreach ( array_merge( $block_type->editor_script_handles, $block_type->view_script_handles ) as $handle ) {
				wp_set_script_translations( $handle, 'fair-form', $translations_path );
			}

			$legacy_name = array_search( $block_type->name, self::LEGACY_NAMES, true );
			if ( false !== $legacy_name ) {
				$this->register_legacy_alias( $legacy_name, $block_type );
			}
		}
	}

	/**
	 * Register a legacy name as a hidden alias of a canonical block.
	 *
	 * The alias renders with the canonical block's template and frontend
	 * assets, so saved content looks and works the same under either name.
	 * It has no editor script of its own: the canonical block's editor script
	 * registers the alias in the editor, where it converts itself to the
	 * canonical block (see src/blocks/shared/register-form-block.js).
	 *
	 * @param string         $legacy_name Legacy block name.
	 * @param \WP_Block_Type $block_type  Registered canonical block type.
	 * @return void
	 */
	private function register_legacy_alias( $legacy_name, \WP_Block_Type $block_type ) {
		register_block_type(
			$legacy_name,
			array(
				'api_version'            => $block_type->api_version,
				'title'                  => $block_type->title,
				'category'               => $block_type->category,
				'icon'                   => $block_type->icon,
				'description'            => $block_type->description,
				'keywords'               => $block_type->keywords,
				'textdomain'             => $block_type->textdomain,
				'parent'                 => self::with_legacy_names( $block_type->parent ),
				'ancestor'               => self::with_legacy_names( $block_type->ancestor ),
				'attributes'             => $block_type->attributes,
				'uses_context'           => $block_type->uses_context,
				'provides_context'       => $block_type->provides_context,
				'supports'               => array_merge( (array) $block_type->supports, array( 'inserter' => false ) ),
				'render_callback'        => $block_type->render_callback,
				'script_handles'         => $block_type->script_handles,
				'view_script_handles'    => $block_type->view_script_handles,
				'view_script_module_ids' => $block_type->view_script_module_ids,
				'style_handles'          => $block_type->style_handles,
				'view_style_handles'     => $block_type->view_style_handles,
			)
		);
	}

	/**
	 * Add the legacy name of every canonical Fair Form block in a parent or
	 * ancestor list.
	 *
	 * @param string[]|null $block_names Block names.
	 * @return string[]|null
	 */
	private static function with_legacy_names( $block_names ) {
		if ( ! is_array( $block_names ) ) {
			return $block_names;
		}

		$legacy_names = array_keys( array_intersect( self::LEGACY_NAMES, $block_names ) );

		return array_values( array_unique( array_merge( $block_names, $legacy_names ) ) );
	}
}
