use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{FnArg, ItemFn, Pat, Path, Token, parse_macro_input, punctuated::Punctuated};

#[proc_macro_attribute]
pub fn command(attributes: TokenStream, item: TokenStream) -> TokenStream {
    let function = parse_macro_input!(item as ItemFn);
    let options: proc_macro2::TokenStream = attributes.into();
    let attribute: syn::Attribute = syn::parse_quote!(#[tauri::command(#options)]);
    let mut external_name = None;
    if let Err(error) = attribute.parse_nested_meta(|meta| {
        if meta.input.peek(Token![=]) {
            let value: syn::LitStr = meta.value()?.parse()?;
            if meta.path.is_ident("rename") {
                external_name = Some(value);
            }
        }
        Ok(())
    }) {
        return error.into_compile_error().into();
    }
    let name = &function.sig.ident;
    let adapter_name = format_ident!("__timed_{}", name);
    let arguments = function
        .sig
        .inputs
        .iter()
        .map(|argument| match argument {
            FnArg::Typed(argument) => match argument.pat.as_ref() {
                Pat::Ident(pattern) => Ok(pattern.ident.clone()),
                _ => Err(syn::Error::new_spanned(
                    argument,
                    "command arguments require names",
                )),
            },
            _ => Err(syn::Error::new_spanned(
                argument,
                "commands are free functions",
            )),
        })
        .collect::<syn::Result<Vec<_>>>();
    let arguments = match arguments {
        Ok(arguments) => arguments,
        Err(error) => return error.into_compile_error().into(),
    };
    let renamed = external_name.is_none().then(|| {
        let original_name = name.to_string();
        quote!(rename = #original_name,)
    });
    let mut adapter = function.clone();
    adapter.sig.ident = adapter_name.clone();
    adapter
        .sig
        .inputs
        .push(syn::parse_quote!(_timing: crate::services::performance_monitor::CommandTiming));
    let waiting = function.sig.asyncness.map(|_| quote!(.await));
    *adapter.block = syn::parse_quote!({ #name(#(#arguments),*)#waiting });
    quote! {
        #function
        #[doc(hidden)]
        #[tauri::command(#renamed #options)]
        #adapter
    }
    .into()
}

#[proc_macro]
pub fn generate_handler(input: TokenStream) -> TokenStream {
    let mut commands =
        parse_macro_input!(input with Punctuated::<Path, Token![,]>::parse_terminated);
    for path in &mut commands {
        let segment = path
            .segments
            .last_mut()
            .expect("command path contains a name");
        segment.ident = format_ident!("__timed_{}", segment.ident);
    }
    quote!(tauri::generate_handler![#commands]).into()
}
